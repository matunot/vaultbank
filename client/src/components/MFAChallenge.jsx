import { useState } from "react";
import {
  useErrorToast,
  useSuccessToast,
  useInfoToast,
} from "./NotificationContainer";

export default function MFAChallenge({ challenge, onComplete, onCancel }) {
  const [verificationCode, setVerificationCode] = useState("");
  const [loading, setLoading] = useState(false);

  const errorToast = useErrorToast();
  const successToast = useSuccessToast();
  const infoToast = useInfoToast();

  // Simulate sending MFA code (email, SMS, authenticator app)
  const sendMfaCode = async (method = "email") => {
    try {
      const response = await fetch("/api/auth/send-mfa-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          actionId: challenge.actionId || challenge.resourceId,
          method,
        }),
      });

      const data = await response.json();

      if (data.success) {
        successToast(`MFA code sent via ${method}`);
        infoToast(
          "Please check your email or authenticator app for the verification code"
        );
      } else {
        errorToast(data.message || "Failed to send MFA code");
      }
    } catch (error) {
      console.error("Send MFA code error:", error);
      errorToast("Failed to send MFA code");
    }
  };

  // Verify MFA code
  const verifyMfaCode = async () => {
    if (!verificationCode.trim()) {
      errorToast("Please enter the verification code");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/verify-mfa-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          code: verificationCode.trim(),
          actionId: challenge.actionId || challenge.resourceId,
          action: challenge.resourceAction || "verify",
        }),
      });

      const data = await response.json();

      if (data.success) {
        successToast("Verification successful! Proceeding with your action.");
        onComplete({
          verified: true,
          method: data.method || "mfa",
          actionId: challenge.actionId,
        });
      } else {
        errorToast(
          data.message || "Invalid verification code. Please try again."
        );
      }
    } catch (error) {
      console.error("Verify MFA code error:", error);
      errorToast("Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Handle escape key
  const handleKeyPress = (e) => {
    if (e.key === "Enter") {
      verifyMfaCode();
    } else if (e.key === "Escape") {
      onCancel && onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                🔐
              </div>
              <div>
                <h3 className="text-lg font-bold">Security Challenge</h3>
                <p className="text-blue-100 text-sm">
                  Additional verification required
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
              🛡️
            </div>
            <h4 className="text-lg font-semibold text-gray-900 mb-2">
              Verify Your Identity
            </h4>
            <p className="text-gray-600 text-sm leading-relaxed">
              {challenge.message ||
                "This action requires additional verification for security. Please complete the verification below."}
            </p>
          </div>

          {/* Risk Information */}
          {challenge.riskScore && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <div className="flex items-center space-x-2">
                <span className="text-yellow-600">⚠️</span>
                <span className="text-yellow-800 font-medium text-sm">
                  Risk Score: {challenge.riskScore}
                </span>
              </div>
              {challenge.severity && (
                <p className="text-yellow-700 text-sm mt-1">
                  Severity:{" "}
                  <span className="capitalize">{challenge.severity}</span>
                </p>
              )}
            </div>
          )}

          {/* MFA Method Selection */}
          <div className="space-y-3 mb-6">
            <label className="block text-sm font-medium text-gray-700">
              Send verification code via:
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => sendMfaCode("email")}
                className="flex flex-col items-center p-3 border-2 border-gray-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <span className="text-2xl mb-1">📧</span>
                <span className="text-sm font-medium">Email</span>
              </button>
              <button
                onClick={() => sendMfaCode("sms")}
                className="flex flex-col items-center p-3 border-2 border-gray-200 rounded-lg hover:border-green-400 hover:bg-green-50 transition-colors"
              >
                <span className="text-2xl mb-2">📱</span>
                <span className="text-sm font-medium">SMS</span>
              </button>
              <button
                onClick={() => sendMfaCode("authenticator")}
                className="flex flex-col items-center p-3 border-2 border-gray-200 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors"
              >
                <span className="text-2xl mb-1">🔐</span>
                <span className="text-sm font-medium">App</span>
              </button>
            </div>
          </div>

          {/* Code Input */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Verification Code
              </label>
              <input
                type="text"
                value={verificationCode}
                onChange={(e) =>
                  setVerificationCode(
                    e.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                onKeyPress={handleKeyPress}
                placeholder="Enter 6-digit code"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-lg font-mono tracking-wider"
                maxLength={6}
              />
              <p className="text-xs text-gray-500 mt-1">
                Enter the code from your email, SMS, or authenticator app
              </p>
            </div>

            {/* Actions */}
            <div className="flex space-x-3 mt-6">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={verifyMfaCode}
                disabled={loading || verificationCode.length < 6}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    Verifying...
                  </div>
                ) : (
                  "Verify & Continue"
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-6 py-4">
          <p className="text-xs text-gray-500 text-center">
            This security step helps protect your account from unauthorized
            access.
          </p>
        </div>
      </div>
    </div>
  );
}
