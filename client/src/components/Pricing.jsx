import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../utils/api";

const Pricing = ({ user, showUpgradeModal, setShowUpgradeModal }) => {
  const [plans, setPlans] = useState({});
  const [currentSubscription, setCurrentSubscription] = useState(null);
  const [upgrading, setUpgrading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Pricing configuration (matches backend)
  const pricingPlans = useMemo(
    () => ({
      free: {
        name: "Free",
        price: 0,
        period: "",
        features: ["Basic banking", "1 account", "Standard transfers"],
        limitations: [
          "No international transfers",
          "Basic analytics only",
          "Limited rewards",
        ],
        buttonText: "Current Plan",
        buttonStyle: "bg-gray-100 text-gray-600 cursor-not-allowed",
        popular: false,
      },
      yearly: {
        name: "Premium Yearly",
        price: 99,
        period: "/year",
        features: [
          "Everything in Free",
          "International transfers",
          "Advanced analytics",
          "Full rewards program",
          "Priority support",
        ],
        limitations: [],
        buttonText: "Upgrade to Yearly",
        buttonStyle: "bg-blue-600 hover:bg-blue-700 text-white",
        popular: true,
      },
      lifetime: {
        name: "Lifetime Premium",
        price: 299,
        period: " one-time",
        features: [
          "Everything in Yearly",
          "Lifetime access",
          "Early feature access",
          "Exclusive rewards",
        ],
        limitations: [],
        buttonText: "Get Lifetime Access",
        buttonStyle: "bg-purple-600 hover:bg-purple-800 text-white",
        popular: false,
      },
    }),
    []
  );

  useEffect(() => {
    // Fetch pricing plans and current subscription
    const fetchPricingData = async () => {
      try {
        // Fetch available plans
        const plansResponse = await api.get("/api/subscription/plans/all");
        if (plansResponse.data.success) {
          setPlans(plansResponse.data.plans);
        }

        // Fetch user's current subscription if logged in
        if (user && user.id) {
          const subscriptionResponse = await api.get(
            `/api/subscription/${user.id}`
          );
          if (subscriptionResponse.data.success) {
            setCurrentSubscription(subscriptionResponse.data.subscription);
          }
        }
      } catch (error) {
        console.error("Error fetching pricing data:", error);
        // Fallback to local pricing data
        setPlans(pricingPlans);
      } finally {
        setLoading(false);
      }
    };

    fetchPricingData();
  }, [user, pricingPlans]);

  const handleUpgrade = async (planType) => {
    if (!user || !user.id) {
      navigate("/login");
      return;
    }

    if (currentSubscription?.currentPlan === planType) {
      return; // Already on this plan
    }

    setSelectedPlan(planType);
    setShowUpgradeModal(true);
  };

  const confirmUpgrade = async () => {
    if (!selectedPlan) return;

    setUpgrading(true);
    try {
      // Mock payment success for demo purposes
      const paymentStatus = "success";

      const response = await api.post("/api/subscription/upgrade", {
        userId: user.id,
        planType: selectedPlan,
        paymentStatus,
      });

      if (response.data.success) {
        // Update local subscription state
        setCurrentSubscription({
          ...currentSubscription,
          currentPlan: selectedPlan,
          isPremium: selectedPlan !== "free",
        });

        setShowUpgradeModal(false);
        setSelectedPlan(null);

        // Show success message or redirect
        alert("Successfully upgraded! Your premium features are now unlocked.");
      } else {
        throw new Error(response.data.message);
      }
    } catch (error) {
      console.error("Upgrade failed:", error);
      alert("Upgrade failed. Please try again or contact support.");
    } finally {
      setUpgrading(false);
    }
  };

  const formatPrice = (price, period) => {
    if (price === 0) return "Free";
    return `$${price}${period}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white py-16 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Choose Your <span className="text-blue-500">VaultBank</span> Plan
          </h1>
          <p className="text-xl text-gray-300 mb-8 max-w-3xl mx-auto">
            Unlock premium banking features and take control of your financial
            future. Start free and upgrade anytime.
          </p>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {Object.entries(plans).map(([planKey, plan]) => {
            const isCurrentPlan = currentSubscription?.currentPlan === planKey;
            const displayPlan = pricingPlans[planKey] || plan;

            return (
              <div
                key={planKey}
                className={`relative bg-gray-800 rounded-2xl p-8 border-2 transition-all duration-300 ${
                  displayPlan.popular
                    ? "border-blue-500 shadow-lg shadow-blue-500/25"
                    : "border-gray-700 hover:border-gray-600"
                } ${isCurrentPlan ? "ring-2 ring-green-500" : ""}`}
              >
                {/* Popular Badge */}
                {displayPlan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="bg-blue-500 text-white px-4 py-2 rounded-full text-sm font-semibold">
                      Most Popular
                    </span>
                  </div>
                )}

                {/* Current Plan Badge */}
                {isCurrentPlan && (
                  <div className="absolute -top-4 right-4">
                    <span className="bg-green-500 text-white px-3 py-1 rounded-full text-xs font-semibold">
                      Current Plan
                    </span>
                  </div>
                )}

                {/* Plan Header */}
                <div className="text-center mb-6">
                  <h3 className="text-2xl font-bold mb-2">
                    {displayPlan.name}
                  </h3>
                  <div className="text-4xl font-bold text-white mb-1">
                    {formatPrice(displayPlan.price, displayPlan.period)}
                  </div>
                  {displayPlan.price > 0 && (
                    <div className="text-gray-400 text-sm">
                      {planKey === "yearly"
                        ? "$8.25/month"
                        : "One-time payment"}
                    </div>
                  )}
                </div>

                {/* Features List */}
                <div className="space-y-4 mb-8">
                  <h4 className="font-semibold text-lg mb-4">
                    What's included:
                  </h4>
                  {displayPlan.features.map((feature, index) => (
                    <div key={index} className="flex items-center space-x-3">
                      <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                        <svg
                          className="w-3 h-3 text-white"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <span className="text-gray-300">{feature}</span>
                    </div>
                  ))}

                  {displayPlan.limitations.length > 0 && (
                    <div className="mt-6">
                      <h5 className="font-semibold text-sm text-red-400 mb-2">
                        Limitations:
                      </h5>
                      {displayPlan.limitations.map((limitation, index) => (
                        <div
                          key={index}
                          className="flex items-center space-x-3 text-gray-400"
                        >
                          <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                            <svg
                              className="w-3 h-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 11-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </div>
                          <span>{limitation}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* CTA Button */}
                <button
                  onClick={() => handleUpgrade(planKey)}
                  disabled={isCurrentPlan}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 ${
                    displayPlan.buttonStyle
                  } ${isCurrentPlan ? "opacity-50" : ""}`}
                >
                  {isCurrentPlan ? "Current Plan" : displayPlan.buttonText}
                </button>
              </div>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="mt-16 max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-8">
            Frequently Asked Questions
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-2">
                Can I change my plan later?
              </h3>
              <p className="text-gray-300">
                Yes! You can upgrade or downgrade your plan anytime. Premium
                features will be immediately available or removed based on your
                new plan.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-2">
                What's included in Premium?
              </h3>
              <p className="text-gray-300">
                International transfers, advanced analytics, full rewards
                marketplace, priority support, and much more as we add features.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-2">Is my data secure?</h3>
              <p className="text-gray-300">
                Absolutely. We use bank-level security with encrypted
                connections and secure data storage. Your financial data is
                always protected.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-xl font-semibold mb-2">Customer support?</h3>
              <p className="text-gray-300">
                Free users get basic support. Premium users get priority email
                support with 24-48 hour response times.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Upgrade Confirmation Modal */}
      {showUpgradeModal && selectedPlan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-8 max-w-md mx-4 w-full">
            <h3 className="text-2xl font-bold mb-4">Confirm Upgrade</h3>
            <div className="mb-6">
              <p className="text-gray-300 mb-2">
                You are about to upgrade to{" "}
                <span className="font-semibold text-blue-400">
                  {pricingPlans[selectedPlan]?.name}
                </span>
              </p>
              <p className="text-2xl font-bold text-white">
                {formatPrice(
                  pricingPlans[selectedPlan]?.price,
                  pricingPlans[selectedPlan]?.period
                )}
              </p>
            </div>

            <div className="flex space-x-4">
              <button
                onClick={() => {
                  setShowUpgradeModal(false);
                  setSelectedPlan(null);
                }}
                className="flex-1 py-3 px-4 bg-gray-700 hover:bg-gray-600 rounded-lg font-semibold transition-colors"
                disabled={upgrading}
              >
                Cancel
              </button>
              <button
                onClick={confirmUpgrade}
                disabled={upgrading}
                className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg font-semibold transition-colors"
              >
                {upgrading ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Processing...
                  </div>
                ) : (
                  "Confirm Upgrade"
                )}
              </button>
            </div>

            <p className="text-xs text-gray-400 mt-4 text-center">
              You can cancel or change your plan anytime from your account
              settings.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Pricing;
