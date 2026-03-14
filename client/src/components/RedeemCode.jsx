import { useState } from "react";
import { useLog, LOG_EVENTS } from "../hooks/useLog";
import { useSuccessToast, useErrorToast } from "./NotificationContainer";

export default function RedeemCode({ onRedeem }) {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const log = useLog(); // No user ID needed for redemption logging
  const successToast = useSuccessToast();
  const errorToast = useErrorToast();

  const handleRedeem = async () => {
    if (!code.trim()) return;

    const redeemCode = code.trim().toUpperCase();
    setLoading(true);
    setStatus("🔄 Verifying code...");

    // Log redemption attempt
    const { requestId } = await log(LOG_EVENTS.BUSINESS_TRANSACTION_CREATED, {
      type: "code_redemption",
      code: redeemCode.substring(0, 3) + "***", // Partial for privacy
    });

    // Simulate backend validation with delay
    setTimeout(async () => {
      if (redeemCode === "PREMIUM2025") {
        setStatus("✅ Code applied! Premium unlocked.");
        successToast("Premium subscription activated!", 5000, requestId);
        onRedeem("premium");

        // Log successful redemption
        await log(LOG_EVENTS.BUSINESS_BALANCE_UPDATED, {
          type: "subscription_upgrade",
          newTier: "premium",
          source: "code_redemption",
        });
      } else if (redeemCode.startsWith("VB-")) {
        // Referral code handling - earn 500 points for successful referral
        try {
          await fetch("/api/rewards/earn", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: localStorage.getItem("token"),
            },
            body: JSON.stringify({
              userId: localStorage.getItem("userId"), // Assume stored in localStorage
              action: "referral",
              actionId: `referral-${redeemCode}-${Date.now()}`,
              points: 500,
              description: `Earned 500 points for successful referral ${redeemCode}`,
              metadata: {
                referralCode: redeemCode,
                creditAmount: 10,
              },
              idempotencyKey: `referral-${redeemCode}-${Date.now()}`,
            }),
          });
        } catch (error) {
          console.error("Failed to earn referral rewards points:", error);
        }

        setStatus(
          "✅ Referral accepted! You earned $10 credit + 500 reward points."
        );
        successToast(
          "$10 credit + 500 reward points applied!",
          5000,
          requestId
        );
        onRedeem("premium"); // Would typically set to premium instead

        // Log successful referral redemption
        await log(LOG_EVENTS.BUSINESS_BALANCE_UPDATED, {
          type: "referral_credit",
          amount: 10,
          points: 500,
          source: "referral_redemption",
        });
      } else {
        setStatus("❌ Invalid or expired code.");
        errorToast(
          "Code is invalid or has already been used.",
          4000,
          requestId
        );
      }

      setLoading(false);
      setCode(""); // Clear input after attempt
    }, 1500); // Simulate network delay
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !loading) {
      handleRedeem();
    }
  };

  return (
    <div className="bg-gradient-to-br from-purple-900/50 to-blue-900/50 text-white p-6 rounded-xl shadow-xl border border-purple-500/20 mt-6">
      <div className="flex items-center space-x-2 mb-4">
        <span className="text-2xl">🎟️</span>
        <h3 className="text-xl font-bold">Redeem a Code</h3>
      </div>

      <p className="text-purple-200 mb-4 text-sm">
        Got a promotional code? Enter it below to unlock Premium features
        instantly!
      </p>

      <div className="flex space-x-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Enter your code"
          className="flex-1 p-3 rounded-lg bg-gray-800/70 border border-purple-500/30 focus:border-yellow-400 focus:outline-none transition-colors font-mono text-center text-lg tracking-wider"
          maxLength={20}
          disabled={loading}
        />
        <button
          onClick={handleRedeem}
          disabled={!code.trim() || loading}
          className="px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-600 text-black rounded-lg font-bold hover:from-yellow-400 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 shadow-lg"
        >
          {loading ? "🔄" : "🎯 Redeem"}
        </button>
      </div>

      {status && (
        <div className="mt-4 p-3 rounded-lg bg-gray-800/50 border border-gray-600/50">
          <div className="flex items-center space-x-2">
            <span className="text-lg">
              {status.includes("✅")
                ? "🎉"
                : status.includes("❌")
                ? "⚠️"
                : "⏳"}
            </span>
            <p className="text-sm">{status}</p>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-purple-300">
        <p>💡 Try the code "PREMIUM2025" for testing</p>
      </div>
    </div>
  );
}
