import { useState, useEffect } from "react";
import { useLog, LOG_EVENTS } from "../hooks/useLog";
import { useSuccessToast, useErrorToast } from "./NotificationContainer";

export default function Transfer({ subscription, user, onTransactionAdd }) {
  // Logging and toast hooks
  const log = useLog(user?.id, subscription);
  const successToast = useSuccessToast();
  const errorToast = useErrorToast();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("domestic");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [iban, setIban] = useState("");
  const [swiftCode, setSwiftCode] = useState("");
  const [vaultbankId, setVaultbankId] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [cryptoType, setCryptoType] = useState("BTC");

  // FX Preview states
  const [sendCurrency, setSendCurrency] = useState("USD");
  const [receiveCurrency, setReceiveCurrency] = useState("EUR");
  const [fxRate, setFxRate] = useState(null);
  const [convertedAmount, setConvertedAmount] = useState(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState(null);

  // Rate limiting states
  const [transferCooldown, setTransferCooldown] = useState(0);

  // Transfer methods configuration
  const methods = [
    { id: "domestic", label: "🏦 Domestic Bank Transfer", premium: false },
    {
      id: "international",
      label: "🌍 International (SWIFT/IBAN)",
      premium: true,
    },
    { id: "vaultbank", label: "⚡ VaultBank Instant Transfer", premium: true },
    { id: "crypto", label: "₿ Crypto Wallet Transfer", premium: true },
    { id: "paypal", label: "💸 PayPal", premium: true },
    { id: "gpay", label: "💳 Google Pay", premium: true },
    { id: "upi", label: "📱 UPI (India)", premium: true },
    { id: "applepay", label: "🍎 Apple Pay", premium: true },
  ];

  // Filter methods based on subscription
  const availableMethods = methods.filter(
    (m) => !m.premium || subscription === "premium" || subscription === "trial"
  );

  // Supported currencies for FX conversion
  const currencies = [
    "USD",
    "EUR",
    "INR",
    "GBP",
    "JPY",
    "AUD",
    "CAD",
    "CHF",
    "CNY",
    "SGD",
  ];

  const handleTransfer = async (e) => {
    e.preventDefault();

    // Log transfer initiation
    const { requestId: initRequestId } = await log(
      LOG_EVENTS.TRANSFER_INITIATED,
      {
        method,
        amount,
        recipient: recipient.substring(0, 10) + "...", // Partial for privacy
      }
    );

    // Check rate limiting
    if (transferCooldown > 0) {
      errorToast(
        `Rate limit exceeded. Please wait ${transferCooldown} seconds before making another transfer.`,
        5000,
        transferCooldown > 2 ? initRequestId : null
      );
      // Log rate limit event
      await log(LOG_EVENTS.SECURITY_RATE_LIMIT, {
        reason: "transfer_cooldown_active",
        cooldown: transferCooldown,
        method,
      });
      return;
    }

    const transferAmount = parseFloat(amount);

    // Validation
    if (!recipient || !recipient.trim()) {
      alert("Please enter a recipient.");
      return;
    }

    if (isNaN(transferAmount) || transferAmount <= 0) {
      alert("Please enter a valid amount greater than 0.");
      return;
    }

    // For external payment methods, check wallet balance but don't debit immediately
    if (method === "upi" || method === "paypal") {
      if (transferAmount > (user?.balance || 0)) {
        alert("Insufficient balance for this transfer.");
        return;
      }

      // Handle external payment methods
      try {
        if (method === "upi") {
          // Initiate UPI payment
          const response = await fetch(`/api/payments/upi/initiate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({
              amount: transferAmount,
              upiId: recipient,
              description: `Transfer to ${recipient}`,
              currency: "INR",
            }),
          });

          const data = await response.json();

          if (data.success) {
            // Open UPI deep link
            window.open(data.upiDeepLink, "_blank");

            successToast(
              `📱 UPI payment initiated! Open your UPI app to complete the payment.`,
              8000,
              initRequestId
            );

            // Clear form
            setRecipient("");
            setAmount("");

            return; // Don't proceed with normal transfer flow
          } else {
            throw new Error(data.message || "UPI payment failed");
          }
        }

        if (method === "paypal") {
          // Initiate PayPal payment
          const response = await fetch(`/api/payments/paypal/initiate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({
              amount: transferAmount,
              currency: "USD",
              description: `Transfer to ${recipient}`,
            }),
          });

          const data = await response.json();

          if (data.success) {
            // Redirect to PayPal
            window.location.href = data.approvalUrl;

            return; // Redirect happens, don't proceed
          } else {
            throw new Error(data.message || "PayPal payment failed");
          }
        }
      } catch (error) {
        console.error(`${method.toUpperCase()} payment error:`, error);
        errorToast(
          `❌ ${method.toUpperCase()} payment failed: ${error.message}`,
          5000,
          initRequestId
        );
        return;
      }
    }

    // For traditional transfers, check balance
    if (transferAmount > (user?.balance || 0)) {
      alert("Insufficient balance for this transfer.");
      return;
    }

    // Method-specific validations for other methods
    if (method === "domestic") {
      if (!accountNumber || !ifscCode) {
        alert("Please enter account number and IFSC code.");
        return;
      }
    }

    if (method === "international") {
      if (!iban || !swiftCode) {
        alert("Please enter IBAN and SWIFT code.");
        return;
      }
    }

    if (method === "vaultbank") {
      if (!vaultbankId) {
        alert("Please enter VaultBank ID or email.");
        return;
      }
    }

    if (method === "crypto") {
      if (!walletAddress) {
        alert("Please enter wallet address.");
        return;
      }
    }

    const newTransaction = {
      id: Date.now(),
      label: `${method.toUpperCase()} Transfer to ${recipient}`,
      amount: -transferAmount,
      date: new Date().toISOString().split("T")[0],
      category: "transfer",
    };

    // Add transaction to user's history
    onTransactionAdd && onTransactionAdd(newTransaction);

    // Earn rewards points for transaction (1 point per ₹100 spent)
    try {
      const pointsToEarn = Math.floor(Math.abs(transferAmount) / 100); // 1 point per ₹100 spent
      if (pointsToEarn > 0) {
        await fetch("/api/rewards/earn", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            userId: user.id || user._id,
            action: "transaction",
            actionId: newTransaction.id.toString(),
            points: pointsToEarn,
            description: `Earned ${pointsToEarn} points for ₹${transferAmount} transfer`,
            metadata: {
              amount: transferAmount,
              method: method,
              recipient: recipient.substring(0, 10) + "...",
            },
            idempotencyKey: `txn-${newTransaction.id}-${Date.now()}`,
          }),
        });
        console.log(`Earned ${pointsToEarn} rewards points for transaction`);
      }
    } catch (error) {
      console.error("Failed to earn rewards points:", error);
      // Don't block transfer if rewards earning fails
    }

    // Set rate limiting cooldown (2-5 seconds based on subscription)
    const cooldownTime =
      subscription === "premium" || subscription === "trial" ? 2 : 5;
    setTransferCooldown(cooldownTime);

    // Countdown timer for rate limiting
    const interval = setInterval(() => {
      setTransferCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Get processing time description
    const getProcessingTime = () => {
      switch (method) {
        case "vaultbank":
          return "⚡ Instant";
        case "crypto":
          return "⟳ 1-3 hours";
        case "international":
          return "🕐 1-5 business days";
        default:
          return "🕐 1-2 business days";
      }
    };

    const processingTime = getProcessingTime();
    const transferMethod = methods
      .find((m) => m.id === method)
      .label.split(" ")[0];

    // Show success toast with request ID
    successToast(
      `⚡ Transfer of $${transferAmount.toFixed(
        2
      )} to ${recipient} via ${transferMethod} initiated!\n\nProcessing time: ${processingTime}`,
      8000,
      initRequestId
    );

    // Log successful transfer initiation
    await log(LOG_EVENTS.TRANSFER_SUCCESS, {
      method,
      amount: transferAmount,
      recipient: recipient.substring(0, 10) + "...",
      processingTime,
      transactionId: newTransaction.id,
    });

    // Reset form after successful transfer
    setRecipient("");
    setAmount("");
    setAccountNumber("");
    setIfscCode("");
    setIban("");
    setSwiftCode("");
    setVaultbankId("");
    setWalletAddress("");
  };

  // FX Preview Logic - Premium Feature
  useEffect(() => {
    if (
      subscription === "free" ||
      !sendCurrency ||
      !receiveCurrency ||
      !amount ||
      sendCurrency === receiveCurrency
    ) {
      setFxRate(null);
      setConvertedAmount(null);
      setFxLoading(false);
      setFxError(null);
      return;
    }

    setFxLoading(true);
    setFxError(null);

    // Fetch real-time exchange rate
    fetch(
      `https://api.exchangerate.host/convert?from=${sendCurrency}&to=${receiveCurrency}&amount=${amount}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setFxRate(data.info.rate);
          setConvertedAmount(data.result);
          setFxError(null);
        } else {
          console.error("FX API Error:", data.error);
          setFxRate(null);
          setConvertedAmount(null);
          setFxError(data.error?.info || "Failed to fetch exchange rate");
        }
      })
      .catch((error) => {
        console.error("FX API Request Failed:", error);
        setFxRate(null);
        setConvertedAmount(null);
        setFxError("Network error - please check your connection");
      })
      .finally(() => {
        setFxLoading(false);
      });
  }, [sendCurrency, receiveCurrency, amount, subscription]);

  return (
    <div className="luxury-card p-6 bg-gradient-to-br from-indigo-900 to-purple-900 text-white rounded-xl shadow-xl">
      <h2 className="text-2xl font-bold mb-6 text-center">
        🚀 Advanced Transfer System
      </h2>

      <form onSubmit={handleTransfer} className="space-y-4">
        {/* Transfer Method Selector */}
        <div className="mb-6">
          <label className="block mb-3 font-semibold text-yellow-400">
            🔧 Choose Transfer Method{" "}
            {subscription === "premium" || subscription === "trial"
              ? "(All Available)"
              : "(Limited)"}
          </label>
          <select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value);
              // Reset form fields when method changes
              setAccountNumber("");
              setIfscCode("");
              setIban("");
              setSwiftCode("");
              setVaultbankId("");
              setWalletAddress("");
            }}
            className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
          >
            {availableMethods.map((m) => (
              <option key={m.id} value={m.id} className="text-white">
                {m.label}{" "}
                {m.premium && <span className="text-yellow-400">★</span>}
              </option>
            ))}
          </select>

          {subscription !== "premium" && subscription !== "trial" && (
            <div className="mt-2 text-sm text-gray-400">
              ✨ Unlock Premium for International, Instant VaultBank transfers,
              and Crypto support!
            </div>
          )}
        </div>

        {/* Recipient Field (Common) */}
        <div>
          <label className="block mb-2 font-semibold">👤 Recipient</label>
          <input
            type="text"
            placeholder={
              method === "vaultbank" ? "VaultBank ID / Email" : "Recipient Name"
            }
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
            required
          />
        </div>

        {/* Method-Specific Fields */}
        {method === "domestic" && (
          <div className="space-y-3">
            <div>
              <label className="block mb-2 font-semibold">
                🏦 Account Number
              </label>
              <input
                type="text"
                placeholder="Enter account number"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>
            <div>
              <label className="block mb-2 font-semibold">🏛️ IFSC Code</label>
              <input
                type="text"
                placeholder="Enter IFSC code"
                value={ifscCode}
                onChange={(e) => setIfscCode(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>
            <div className="bg-blue-600/20 p-3 rounded">
              <p className="text-xs text-blue-300">
                🕐 Processing: 1-2 business days
              </p>
            </div>
          </div>
        )}

        {method === "international" && (
          <div className="space-y-3">
            {/* FX Currency Selectors - Premium Feature */}
            {subscription === "premium" || subscription === "trial" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block mb-2 font-semibold">
                      💱 Send Currency
                    </label>
                    <select
                      value={sendCurrency}
                      onChange={(e) => setSendCurrency(e.target.value)}
                      className="w-full p-2 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                    >
                      {currencies.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block mb-2 font-semibold">
                      💱 Receive Currency
                    </label>
                    <select
                      value={receiveCurrency}
                      onChange={(e) => setReceiveCurrency(e.target.value)}
                      className="w-full p-2 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                    >
                      {currencies.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-gray-700/50 p-3 rounded">
                <p className="text-sm text-gray-300">
                  🔒 Unlock Premium for real-time FX rates and currency
                  conversion preview
                </p>
              </div>
            )}

            {/* FX Preview for Free Users */}
            {subscription === "free" && (
              <div className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 p-4 rounded-lg border border-yellow-500/30">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="text-2xl">💱</span>
                  <span className="font-semibold text-yellow-400">
                    FX Preview (Premium Feature)
                  </span>
                </div>
                <p className="text-sm text-gray-300 mb-1">
                  💱 See live exchange rates before sending
                </p>
                <p className="text-sm text-gray-300 mb-1">
                  💸 Preview exact amount recipient receives
                </p>
                <p className="text-sm text-yellow-400 font-semibold">
                  🎯 Avoid surprises with real-time currency conversion
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Upgrade to Premium to unlock this feature
                </p>
              </div>
            )}

            <div>
              <label className="block mb-2 font-semibold">🌍 IBAN</label>
              <input
                type="text"
                placeholder="International Banking Account Number"
                value={iban}
                onChange={(e) => setIban(e.target.value.toUpperCase())}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>
            <div>
              <label className="block mb-2 font-semibold">🏛️ SWIFT Code</label>
              <input
                type="text"
                placeholder="Bank Identifier Code (BIC)"
                value={swiftCode}
                onChange={(e) => setSwiftCode(e.target.value.toUpperCase())}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>

            {/* FX Preview Display - Premium Feature */}
            {subscription === "premium" || subscription === "trial" ? (
              <>
                {fxLoading && (
                  <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 p-4 rounded-lg border border-blue-500/30">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-2xl">⏳</span>
                      <span className="font-semibold text-blue-400">
                        Fetching Live FX Rates...
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
                      <span className="text-sm text-gray-300">
                        Getting real-time exchange rates
                      </span>
                    </div>
                  </div>
                )}

                {fxError && (
                  <div className="bg-gradient-to-r from-red-600/20 to-orange-600/20 p-4 rounded-lg border border-red-500/30">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-2xl">⚠️</span>
                      <span className="font-semibold text-red-400">
                        FX Rate Unavailable
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mb-1">{fxError}</p>
                    <p className="text-xs text-gray-400">
                      Please check your connection and try again
                    </p>
                  </div>
                )}

                {fxRate && convertedAmount && !fxLoading && !fxError && (
                  <div className="bg-gradient-to-r from-green-600/20 to-blue-600/20 p-4 rounded-lg border border-green-500/30">
                    <div className="flex items-center space-x-2 mb-2">
                      <span className="text-2xl">💱</span>
                      <span className="font-semibold text-green-400">
                        Live FX Preview
                      </span>
                    </div>
                    <p className="text-sm text-gray-300 mb-1">
                      💱 Rate: 1 {sendCurrency} = {fxRate.toFixed(4)}{" "}
                      {receiveCurrency}
                    </p>
                    <p className="text-sm text-gray-300 mb-1">
                      💸 You send: {amount} {sendCurrency}
                    </p>
                    <p className="text-sm text-green-400 font-semibold">
                      🎯 Recipient receives: {convertedAmount.toFixed(2)}{" "}
                      {receiveCurrency}
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                      *Rates are indicative and may vary at time of transfer
                    </p>
                  </div>
                )}

                {/* Test FX Preview Button */}
                <div className="flex justify-center">
                  <button
                    onClick={() => {
                      setAmount("1000");
                      setSendCurrency("USD");
                      setReceiveCurrency("INR");
                    }}
                    className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors shadow-lg text-sm"
                  >
                    💱 Test FX Preview (USD → INR)
                  </button>
                </div>
              </>
            ) : null}

            <div className="bg-purple-600/20 p-3 rounded">
              <p className="text-xs text-purple-300">
                🕐 Processing: 1-5 business days • 💰 International fees apply
                {subscription === "premium" || subscription === "trial"
                  ? " • 💱 Live FX rates included"
                  : ""}
              </p>
            </div>
          </div>
        )}

        {method === "vaultbank" && (
          <div className="space-y-3">
            <div>
              <label className="block mb-2 font-semibold">
                ⚡ VaultBank ID / Email
              </label>
              <input
                type="text"
                placeholder="Recipient's VaultBank ID or email"
                value={vaultbankId}
                onChange={(e) => setVaultbankId(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>
            <div className="bg-green-600/20 p-3 rounded">
              <p className="text-xs text-green-300">
                ⚡ Processing: Instant • 💯 No hidden fees
              </p>
            </div>
          </div>
        )}

        {method === "crypto" && (
          <div className="space-y-3">
            <div>
              <label className="block mb-2 font-semibold">
                ₿ Wallet Address
              </label>
              <input
                type="text"
                placeholder="Recipient crypto wallet address"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors font-mono text-sm"
                required
              />
            </div>
            <div>
              <label className="block mb-2 font-semibold">
                💱 Cryptocurrency
              </label>
              <select
                value={cryptoType}
                onChange={(e) => setCryptoType(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
              >
                <option value="BTC">₿ Bitcoin (BTC)</option>
                <option value="ETH">♦ Ethereum (ETH)</option>
                <option value="USDT">₮ Tether (USDT)</option>
                <option value="ADA">₳ Cardano (ADA)</option>
                <option value="DOT">● Polkadot (DOT)</option>
              </select>
            </div>
            <div className="bg-orange-600/20 p-3 rounded">
              <p className="text-xs text-orange-300">
                ⟳ Processing: 1-3 hours • 💰 Network fees apply
              </p>
            </div>
          </div>
        )}

        {method === "paypal" && (
          <div className="space-y-3">
            <div>
              <label className="block mb-2 font-semibold">
                💸 PayPal Email
              </label>
              <input
                type="email"
                placeholder="recipient@example.com"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>
            <div className="bg-blue-600/20 p-3 rounded">
              <p className="text-xs text-blue-300">
                ⚡ Processing:{" "}
                {subscription === "premium" || subscription === "trial"
                  ? "⚡ 15-30 minutes"
                  : "🕐 2-4 hours"}{" "}
                • 💰 2.9% + $0.30 fee
              </p>
            </div>
          </div>
        )}

        {method === "gpay" && (
          <div className="space-y-3">
            <div>
              <label className="block mb-2 font-semibold">
                💳 Google Pay ID
              </label>
              <input
                type="text"
                placeholder="Google Pay ID or Phone Number"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>
            <div className="bg-green-600/20 p-3 rounded">
              <p className="text-xs text-green-300">
                ⚡ Processing:{" "}
                {subscription === "premium" || subscription === "trial"
                  ? "⚡ 5-10 minutes"
                  : "🕐 1-2 hours"}{" "}
                • 💰 Free for UPI transactions
              </p>
            </div>
          </div>
        )}

        {method === "upi" && (
          <div className="space-y-3">
            <div>
              <label className="block mb-2 font-semibold">📱 UPI ID</label>
              <input
                type="text"
                placeholder="username@upi or phone@upi"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>
            <div className="bg-teal-600/20 p-3 rounded">
              <p className="text-xs text-teal-300">
                ⚡ Processing:{" "}
                {subscription === "premium" || subscription === "trial"
                  ? "⚡ Instant"
                  : "🕐 30 minutes - 2 hours"}{" "}
                • 💰 Free instant transfers
              </p>
            </div>
          </div>
        )}

        {method === "applepay" && (
          <div className="space-y-3">
            <div>
              <label className="block mb-2 font-semibold">
                🍎 Apple Pay ID
              </label>
              <input
                type="email"
                placeholder="Apple ID email or phone number"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                required
              />
            </div>
            <div className="bg-gray-600/20 p-3 rounded">
              <p className="text-xs text-gray-300">
                ⚡ Processing:{" "}
                {subscription === "premium" || subscription === "trial"
                  ? "⚡ 10-20 minutes"
                  : "🕐 1-3 hours"}{" "}
                • 💰 3% fee for international
              </p>
            </div>
          </div>
        )}

        {/* Amount Field */}
        <div>
          <label className="block mb-2 font-semibold">💰 Amount</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full p-3 rounded bg-gray-800 text-white border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
            required
          />
        </div>

        {/* Balance Info */}
        <div className="bg-black/20 p-3 rounded text-center">
          <p className="text-sm text-gray-300">
            💎 Available Balance:{" "}
            <span className="text-green-400 font-bold">
              ${(user?.balance || 0).toFixed(2)}
            </span>
          </p>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={
            !recipient ||
            !amount ||
            (user?.balance || 0) < parseFloat(amount || 0)
          }
          className="w-full bg-gradient-to-r from-yellow-500 to-orange-600 text-black font-bold py-4 rounded-lg hover:from-yellow-400 hover:to-orange-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 shadow-lg hover:shadow-xl"
        >
          🚀 {methods.find((m) => m.id === method).label.split(" ")[0]} Transfer
          Now
        </button>

        {/* Fee Information */}
        <div className="text-center text-xs text-gray-400 mt-2">
          <p>
            {method === "vaultbank"
              ? "✨ VaultBank Instant transfers: Absolutely FREE"
              : method === "domestic"
              ? "💳 Domestic transfers: Competitive rates apply"
              : method === "international"
              ? "🌍 International transfers: USD 15-35 + exchange rate"
              : "₿ Crypto transfers: Pay network gas fees"}
          </p>
        </div>
      </form>
    </div>
  );
}
