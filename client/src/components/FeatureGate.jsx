import React, { useState } from "react";
import { useNavigate } from "react-router-dom";

const FeatureGate = ({
  children,
  feature,
  featureName,
  isPremium,
  requiredPlan = "yearly",
  user,
  setShowUpgradeModal,
}) => {
  const navigate = useNavigate();
  const [showGateModal, setShowGateModal] = useState(false);

  // If user is premium or feature is available, show children
  if (isPremium || !feature) {
    return <>{children}</>;
  }

  // What plan is required for this feature
  const planName =
    requiredPlan === "yearly" ? "Premium Yearly" : "Lifetime Premium";
  const pricing = requiredPlan === "yearly" ? 99 : 299;

  const handleUpgradeClick = () => {
    if (user) {
      setShowUpgradeModal(true);
      setShowGateModal(false);
    } else {
      navigate("/pricing");
    }
  };

  const handleViewPricing = () => {
    navigate("/pricing");
    setShowGateModal(false);
  };

  return (
    <>
      <div
        className="relative cursor-pointer"
        onClick={() => setShowGateModal(true)}
      >
        {/* Overlay to indicate locked feature */}
        <div className="absolute inset-0 bg-black bg-opacity-60 z-10 rounded-lg flex items-center justify-center">
          <div className="text-center">
            <svg
              className="w-8 h-8 mx-auto mb-2 text-yellow-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
            <span className="text-sm font-medium text-yellow-400">
              Premium Feature
            </span>
          </div>
        </div>

        {/* Dimmed content */}
        <div className="opacity-40 pointer-events-none">{children}</div>
      </div>

      {/* Premium Feature Modal */}
      {showGateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-8 max-w-md mx-4 w-full">
            {/* Close button */}
            <button
              onClick={() => setShowGateModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* Premium Feature Icon */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full mb-4">
                <svg
                  className="w-8 h-8 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                  />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-white mb-2">
                {featureName}
              </h3>
              <p className="text-gray-300 text-sm">
                Unlock this powerful feature with Premium
              </p>
            </div>

            {/* Feature Benefits */}
            <div className="bg-gray-700 rounded-lg p-4 mb-6">
              <h4 className="font-semibold text-yellow-400 mb-2">
                Premium Benefits:
              </h4>
              <ul className="space-y-2 text-sm text-gray-300">
                <li className="flex items-center">
                  <svg
                    className="w-4 h-4 text-green-400 mr-2 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  International transfers & advanced analytics
                </li>
                <li className="flex items-center">
                  <svg
                    className="w-4 h-4 text-green-400 mr-2 flex-shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Full rewards marketplace & VIP support
                </li>
              </ul>
            </div>

            {/* Pricing Info */}
            <div className="text-center mb-6">
              <p className="text-gray-300 mb-2">Upgrade to {planName}</p>
              <div className="text-3xl font-bold text-white">${pricing}</div>
              <div className="text-sm text-gray-400">
                {requiredPlan === "yearly"
                  ? "per year ($8.25/month)"
                  : "one-time payment"}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={handleUpgradeClick}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-bold py-3 px-4 rounded-lg transition-all duration-200 transform hover:shadow-lg"
              >
                🚀 Upgrade to Premium
              </button>

              <button
                onClick={handleViewPricing}
                className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white font-medium py-3 px-4 rounded-lg transition-all duration-200"
              >
                View All Plans
              </button>
            </div>

            <p className="text-xs text-gray-400 mt-4 text-center">
              Cancel anytime • Secure payment • Money-back guarantee
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default FeatureGate;
