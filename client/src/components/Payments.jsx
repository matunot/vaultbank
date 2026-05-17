import { useState } from "react";
import { useSuccessToast, useErrorToast } from "./NotificationContainer";
// Removed unused import of api

/**
 * Payments – Simple UI for initiating UPI or PayPal payments.
 * This component provides a minimal form to send money using the
 * backend payment routes defined in `server/routes/payments.js`.
 */
export default function Payments({ subscription, user }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("paypal");
  const [loading, setLoading] = useState(false);

  const successToast = useSuccessToast();
  const errorToast = useErrorToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!recipient.trim() || !amount) {
      errorToast("Please provide both recipient and amount.", 4000);
      return;
    }
    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      errorToast("Enter a valid amount greater than 0.", 4000);
      return;
    }
    setLoading(true);
    try {
      if (method === "upi") {
        // Initiate UPI payment via backend
        const response = await fetch(`/api/payments/upi/initiate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            amount: transferAmount,
            upiId: recipient,
            description: `Payment to ${recipient}`,
            currency: "INR",
          }),
        });
        const data = await response.json();
        if (data.success) {
          // Open the deep link for the user's UPI app
          window.open(data.upiDeepLink, "_blank");
          successToast(
            `📱 UPI payment initiated! Open your UPI app to complete the payment.`,
            8000,
          );
        } else {
          throw new Error(data.message || "UPI payment failed");
        }
      } else if (method === "paypal") {
        // Initiate PayPal payment via backend
        const response = await fetch(`/api/payments/paypal/initiate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            amount: transferAmount,
            currency: "USD",
            description: `Payment to ${recipient}`,
          }),
        });
        const data = await response.json();
        if (data.success) {
          // Redirect to PayPal approval URL
          window.location.href = data.approvalUrl;
        } else {
          throw new Error(data.message || "PayPal payment failed");
        }
      } else if (method === "stripe") {
        // Initiate Stripe payment via backend
        const response = await fetch(`/api/payments/stripe/initiate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            amount: transferAmount,
            currency: "USD",
            description: `Payment to ${recipient}`,
          }),
        });
        const data = await response.json();
        if (data.success) {
          // Redirect to Stripe checkout
          window.location.href = data.checkoutUrl;
        } else {
          throw new Error(data.message || "Stripe payment failed");
        }
      } else if (method === "bank") {
        // Initiate Bank Transfer via backend
        const response = await fetch(`/api/payments/bank/initiate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            amount: transferAmount,
            currency: "USD",
            description: `Payment to ${recipient}`,
            recipientAccount: recipient,
          }),
        });
        const data = await response.json();
        if (data.success) {
          successToast(
            `🏦 Bank transfer initiated! Reference: ${data.reference}. Check your email for details.`,
            8000,
          );
        } else {
          throw new Error(data.message || "Bank transfer failed");
        }
      }
    } catch (error) {
      console.error(`${method.toUpperCase()} payment error:`, error);
      errorToast(
        `❌ ${method.toUpperCase()} payment failed: ${error.message}`,
        5000,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="luxury-card p-6 bg-gradient-to-br from-indigo-900 to-purple-900 text-white rounded-xl shadow-xl">
      <h2 className="text-2xl font-bold mb-6 text-center">💰 Payments</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-2 font-semibold">Payment Method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full p-3 rounded bg-gray-800 text-white"
          >
            <option value="upi">📱 UPI (India)</option>
            <option value="paypal">💸 PayPal</option>
            <option value="stripe">💳 Stripe</option>
            <option value="bank">🏦 Bank Transfer</option>
          </select>
        </div>
        <div>
          <label className="block mb-2 font-semibold">
            {method === "upi" ? "UPI ID" : "PayPal Email"}
          </label>
          <input
            type={method === "upi" ? "text" : "email"}
            placeholder={
              method === "upi" ? "example@upi" : "recipient@example.com"
            }
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full p-3 rounded bg-gray-800 text-white"
            required
          />
        </div>
        <div>
          <label className="block mb-2 font-semibold">Amount</label>
          <input
            type="number"
            placeholder="Enter amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full p-3 rounded bg-gray-800 text-white"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-gradient-to-r from-green-500 to-teal-600 text-white rounded font-semibold hover:opacity-90 transition"
        >
          {loading ? "Processing…" : "Send Payment"}
        </button>
      </form>
    </div>
  );
}
