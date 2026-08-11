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
            success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard?deposit=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/dashboard?deposit=cancelled`,
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

        try {
            event = stripeInstance.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
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

module.exports = router;