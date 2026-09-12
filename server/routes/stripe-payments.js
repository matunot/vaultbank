/**
 * VaultBank Stripe Payment Routes
 * 
 * Real money processing with Stripe:
 * - Create checkout sessions for deposits
 * - Handle webhooks for payment confirmation
 * - Process withdrawals via Stripe payouts
 * - Manage connected accounts
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
    findUserById,
    findAccountByUserId,
    updateAccountBalance,
    createTransaction,
    createNotification,
    createAuditLog,
    db,
} = require('../config/database');

// Stripe initialization (lazy - only when keys are configured)
let stripe = null;
const getStripe = () => {
    if (!stripe) {
        const key = process.env.STRIPE_SECRET_KEY || process.env.PAYMENT_PROVIDER_STRIPE_SECRET;
        if (!key || key.includes('placeholder')) {
            return null; // No real Stripe key configured
        }
        stripe = require('stripe')(key);
    }
    return stripe;
};

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// ============================================================
// POST /api/stripe/deposit — Create a Stripe Checkout Session for deposit
// ============================================================
router.post('/api/stripe/deposit', authenticateToken, async (req, res) => {
    try {
        const { amount, currency = 'usd' } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid amount.' });
        }

        if (amount < 1) {
            return res.status(400).json({ success: false, message: 'Minimum deposit is $1.00.' });
        }

        if (amount > 100000) {
            return res.status(400).json({ success: false, message: 'Maximum single deposit is $100,000.' });
        }

        const stripeInstance = getStripe();
        if (!stripeInstance) {
            // Demo mode - simulate deposit
            const account = await findAccountByUserId(req.user.id);
            if (!account) {
                return res.status(404).json({ success: false, message: 'No account found.' });
            }

            const balanceBefore = parseFloat(account.balance);
            const depositAmount = parseFloat(amount);
            const newBalance = balanceBefore + depositAmount;

            await updateAccountBalance(account.id, newBalance);
            await createTransaction({
                account_id: account.id,
                user_id: req.user.id,
                type: 'deposit',
                status: 'completed',
                amount: depositAmount,
                currency: account.currency,
                balance_before: balanceBefore,
                balance_after: newBalance,
                description: `Deposit of $${depositAmount.toFixed(2)} (demo mode)`,
                category: 'income',
                metadata: { mode: 'demo', simulated: true }
            });

            await createNotification(req.user.id, {
                type: 'transaction',
                title: 'Deposit Successful',
                message: `$${depositAmount.toFixed(2)} has been deposited. New balance: $${newBalance.toFixed(2)}`
            });

            return res.json({
                success: true,
                message: `Successfully deposited $${depositAmount.toFixed(2)} (demo mode)`,
                balance: { available: newBalance, current: newBalance, currency: account.currency },
                mode: 'demo'
            });
        }

        // Real Stripe mode
        const account = await findAccountByUserId(req.user.id);
        const user = await findUserById(req.user.id);

        const session = await stripeInstance.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency,
                    product_data: {
                        name: 'VaultBank Account Deposit',
                        description: `Deposit $${parseFloat(amount).toFixed(2)} to your VaultBank account`,
                    },
                    unit_amount: Math.round(parseFloat(amount) * 100), // cents
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/?deposit=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL || 'http://localhost:5173'}/?deposit=cancelled`,
            metadata: {
                userId: req.user.id,
                accountId: account.id,
                type: 'deposit',
            },
            customer_email: user.email,
        });

        res.json({
            success: true,
            checkoutUrl: session.url,
            sessionId: session.id,
        });
    } catch (error) {
        console.error('Stripe deposit error:', error);
        res.status(500).json({ success: false, message: 'Failed to create deposit session.' });
    }
});

// ============================================================
// POST /api/stripe/webhook — Handle Stripe webhooks
// ============================================================
router.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const stripeInstance = getStripe();
        if (!stripeInstance) {
            return res.status(200).json({ received: true, mode: 'demo' });
        }

        const sig = req.headers['stripe-signature'];
        let event;

        event = null;
        let lastSigErr = null;
        const candidateSecrets = [STRIPE_WEBHOOK_SECRET].filter(Boolean);
        try {
            const cfgRow = await db.query("SELECT value FROM server_config WHERE key = 'issuing_webhook_secret'");
            if (cfgRow.rows[0] && cfgRow.rows[0].value) candidateSecrets.push(cfgRow.rows[0].value);
        } catch (e) { /* server_config table may not exist yet */ }
        for (const secret of candidateSecrets) {
            try {
                event = stripeInstance.webhooks.constructEvent(req.body, sig, secret);
                break;
            } catch (err) {
                lastSigErr = err;
            }
        }
        if (!event) {
            console.error('Webhook signature verification failed:', lastSigErr && lastSigErr.message);
            return res.status(400).send('Webhook Error: ' + (lastSigErr && lastSigErr.message));
        }

        // Real-time card authorizations MUST be answered synchronously.
        if (event.type === 'issuing_authorization.request') {
            return await handleCardAuthorization(res, event);
        }

        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const { userId, accountId } = session.metadata;

                if (userId && accountId) {
                    const account = await db.query('SELECT * FROM accounts WHERE id = $1', [accountId]);
                    if (account.rows.length > 0) {
                        const acc = account.rows[0];
                        const amount = session.amount_total / 100; // from cents
                        const balanceBefore = parseFloat(acc.balance);
                        const newBalance = balanceBefore + amount;

                        await updateAccountBalance(accountId, newBalance);
                        await createTransaction({
                            account_id: accountId,
                            user_id: userId,
                            type: 'stripe_deposit',
                            status: 'completed',
                            amount,
                            currency: (session.currency || 'usd').toUpperCase(),
                            balance_before: balanceBefore,
                            balance_after: newBalance,
                            description: `Stripe deposit - $${amount.toFixed(2)}`,
                            category: 'income',
                            external_reference: session.payment_intent,
                            metadata: { stripeSessionId: session.id }
                        });

                        await createNotification(userId, {
                            type: 'transaction',
                            title: 'Deposit Confirmed',
                            message: `$${amount.toFixed(2)} deposit confirmed via Stripe. New balance: $${newBalance.toFixed(2)}`
                        });
                    }
                }
                break;
            }

            case 'payment_intent.payment_failed': {
                const intent = event.data.object;
                console.error('Payment failed:', intent.id, intent.last_payment_error?.message);
                break;
            }

            case 'issuing_transaction.created': {
                await handleCardTransaction(event);
                break;
            }

            case 'issuing_card.created': {
                const issuedCard = event.data.object;
                if (issuedCard.metadata && issuedCard.metadata.vaultbank_user_id) {
                    await createNotification(issuedCard.metadata.vaultbank_user_id, {
                        type: 'success',
                        title: 'Your card is ready',
                        message: 'A new VaultBank card ending ' + issuedCard.last4 + ' was created.',
                    });
                }
                break;
            }

            case 'issuing_cardholder.created': {
                console.log('Issuing cardholder created:', event.data.object.id);
                break;
            }

            default:
                console.log(`Unhandled Stripe event: ${event.type}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook handler failed' });
    }
});

// ============================================================
// GET /api/stripe/balance — Get Stripe account balance
// ============================================================
router.get('/api/stripe/balance', authenticateToken, async (req, res) => {
    try {
        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }

        const stripeInstance = getStripe();
        if (!stripeInstance) {
            return res.json({
                success: true,
                balance: {
                    available: parseFloat(account.available_balance),
                    pending: 0,
                    currency: account.currency,
                },
                mode: 'demo'
            });
        }

        const balance = await stripeInstance.balance.retrieve();
        res.json({
            success: true,
            balance: {
                available: balance.available.reduce((sum, b) => sum + b.amount, 0) / 100,
                pending: balance.pending.reduce((sum, b) => sum + b.amount, 0) / 100,
                currency: 'usd',
            },
            mode: 'live'
        });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ success: false, message: 'Failed to get balance.' });
    }
});

// ============================================================
// POST /api/stripe/withdraw — Create a withdrawal (Stripe payout)
// ============================================================
router.post('/api/stripe/withdraw', authenticateToken, async (req, res) => {
    try {
        const { amount, bankAccountId } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid amount.' });
        }

        const account = await findAccountByUserId(req.user.id);
        if (!account) {
            return res.status(404).json({ success: false, message: 'No account found.' });
        }

        const withdrawAmount = parseFloat(amount);
        const balanceBefore = parseFloat(account.balance);

        if (withdrawAmount > balanceBefore) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient funds.',
                availableBalance: balanceBefore
            });
        }

        const stripeInstance = getStripe();
        if (!stripeInstance) {
            // Demo mode
            const newBalance = balanceBefore - withdrawAmount;
            await updateAccountBalance(account.id, newBalance);
            await createTransaction({
                account_id: account.id,
                user_id: req.user.id,
                type: 'withdrawal',
                status: 'completed',
                amount: -withdrawAmount,
                currency: account.currency,
                balance_before: balanceBefore,
                balance_after: newBalance,
                description: `Withdrawal of $${withdrawAmount.toFixed(2)} (demo mode)`,
                category: 'expense',
            });

            await createNotification(req.user.id, {
                type: 'transaction',
                title: 'Withdrawal Successful',
                message: `$${withdrawAmount.toFixed(2)} withdrawn. New balance: $${newBalance.toFixed(2)}`
            });

            return res.json({
                success: true,
                message: `Successfully withdrew $${withdrawAmount.toFixed(2)} (demo mode)`,
                balance: { available: newBalance, current: newBalance, currency: account.currency },
                mode: 'demo'
            });
        }

        // Real Stripe payout
        const user = await findUserById(req.user.id);
        if (!user.stripe_connect_account_id) {
            return res.status(400).json({
                success: false,
                message: 'Please link a bank account first to enable withdrawals.'
            });
        }

        const payout = await stripeInstance.payouts.create({
            amount: Math.round(withdrawAmount * 100),
            currency: 'usd',
            destination: bankAccountId,
        }, {
            stripeAccount: user.stripe_connect_account_id,
        });

        const newBalance = balanceBefore - withdrawAmount;
        await updateAccountBalance(account.id, newBalance);
        await createTransaction({
            account_id: account.id,
            user_id: req.user.id,
            type: 'stripe_withdrawal',
            status: 'processing',
            amount: -withdrawAmount,
            currency: account.currency,
            balance_before: balanceBefore,
            balance_after: newBalance,
            description: `Withdrawal via Stripe`,
            category: 'expense',
            external_reference: payout.id,
        });

        res.json({
            success: true,
            message: `Withdrawal of $${withdrawAmount.toFixed(2)} initiated. Processing time: 1-2 business days.`,
            payoutId: payout.id,
            balance: { available: newBalance, current: newBalance, currency: account.currency },
            mode: 'live'
        });
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(500).json({ success: false, message: 'Withdrawal failed.' });
    }
});


// ============================================================
// Issuing webhook helpers - real-time card authorizations
// ============================================================
async function handleCardAuthorization(res, event) {
    try {
        const auth = event.data.object;
        const cardId = typeof auth.card === 'string' ? auth.card : auth.card.id;
        const { rows } = await db.query(
            'SELECT c.user_id, a.balance FROM issued_cards c JOIN accounts a ON a.user_id = c.user_id WHERE c.card_id = $1 LIMIT 1',
            [cardId]
        );
        if (rows.length === 0) {
            return res.json({ declined: 'card_not_found' });
        }
        const amount = (auth.amount || 0) / 100;
        const balance = parseFloat(rows[0].balance);
        if (amount > balance) {
            await createNotification(rows[0].user_id, {
                type: 'warning',
                title: 'Card declined',
                message: '$' + amount.toFixed(2) + ' authorization declined (insufficient funds). Balance $' + balance.toFixed(2) + '.',
            });
            return res.json({ declined: 'insufficient_funds' });
        }
        return res.json({ approved: true });
    } catch (e) {
        console.error('Authorization handler error:', e.message);
        return res.json({ declined: 'server_error' });
    }
}

async function handleCardTransaction(event) {
    try {
        const tx = event.data.object;
        const cardId = typeof tx.card === 'string' ? tx.card : tx.card.id;
        const { rows } = await db.query('SELECT * FROM issued_cards WHERE card_id = $1', [cardId]);
        if (rows.length === 0) return;
        const row = rows[0];
        const account = await findAccountByUserId(row.user_id);
        if (!account) return;
        const amount = Math.abs(tx.amount || 0) / 100;
        // ponytail: atomic debit — concurrent taps can't overdraft; CHECK allows card_charge
        const { rows: debited } = await db.query(
            'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance',
            [account.id, amount]
        );
        if (debited.length === 0) {
            await createNotification(row.user_id, {
                type: 'warning',
                title: 'Card declined',
                message: '$' + amount.toFixed(2) + ' card charge declined (insufficient funds).',
            });
            return;
        }
        const newBalance = parseFloat(debited[0].balance);
        const balanceBefore = newBalance + amount;
        const merchant = (tx.merchant_data && (tx.merchant_data.merchant_name || tx.merchant_data.network_id)) || 'Merchant';
        await createTransaction({
            account_id: account.id,
            user_id: row.user_id,
            type: 'card_charge',
            status: 'completed',
            amount: -amount,
            currency: account.currency,
            balance_before: balanceBefore,
            balance_after: newBalance,
            description: merchant + ' · ' + (row.brand_label || 'Card') + ' •• ' + row.last4,
            category: 'expense',
            external_reference: tx.id,
            metadata: { issuing: true, card_id: cardId },
        });
        await createNotification(row.user_id, {
            type: 'transaction',
            title: 'Card charged',
            message: '$' + amount.toFixed(2) + ' at ' + merchant + ' with ' + (row.brand_label || 'card') + ' •• ' + row.last4 + '. New balance $' + newBalance.toFixed(2) + '.',
        });
    } catch (e) {
        console.error('Card transaction handler error:', e.message);
    }
}
module.exports = router;