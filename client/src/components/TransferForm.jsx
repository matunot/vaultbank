import { useState } from "react";
import { useSuccessToast, useErrorToast } from "./NotificationContainer";
import { api } from "../config/apiConfig";

/**
 * TransferForm – Simple UI for initiating a transfer.
 * This component provides a minimal form to send money to a recipient.
 * It uses the same backend endpoint as the full Transfer component.
 */
export default function TransferForm({ subscription, user, onTransactionAdd }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
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
      const payload = {
        amount: transferAmount,
        recipient,
        method: "vaultbank", // default method
      };
      const response = await api.post("/api/transfers", payload);
      const { transaction } = response;
      // Add transaction to parent state if callback provided
      onTransactionAdd && onTransactionAdd(transaction);
      successToast(
        `Transfer of $${transferAmount.toFixed(2)} to ${recipient} initiated!`,
        5000,
      );
      setRecipient("");
      setAmount("");
    } catch (err) {
      console.error("Transfer error:", err);
      errorToast(err.message || "Transfer failed.", 5000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="luxury-card p-6 bg-gradient-to-br from-indigo-900 to-purple-900 text-white rounded-xl shadow-xl">
      <h2 className="text-2xl font-bold mb-4 text-center">💸 Quick Transfer</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-1">Recipient Email</label>
          <input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="w-full p-2 rounded bg-gray-800 text-white"
            required
          />
        </div>
        <div>
          <label className="block mb-1">Amount</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full p-2 rounded bg-gray-800 text-white"
            required
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 bg-gradient-to-r from-green-500 to-teal-600 text-white rounded font-semibold hover:opacity-90 transition"
        >
          {loading ? "Processing…" : "Send Transfer"}
        </button>
      </form>
    </div>
  );
}
