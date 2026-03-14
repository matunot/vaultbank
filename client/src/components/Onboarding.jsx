import React, { useState, useEffect, useRef, useCallback } from "react";
import Confetti from "react-confetti";

const ONBOARDING_STEPS = {
  INTRO: "intro",
  CHECKLIST: "checklist",
  TOUR: "tour",
  FINISH: "finish",
};

const CHECKLIST_ITEMS = [
  { id: "create-account", label: "Create your first account", icon: "🏦" },
  { id: "send-money", label: "Send or receive money", icon: "💸" },
  { id: "set-budget", label: "Set a budget for spending", icon: "📊" },
  {
    id: "explore-analytics",
    label: "Explore your financial insights",
    icon: "📈",
  },
  {
    id: "customize-settings",
    label: "Customize your dashboard settings",
    icon: "⚙️",
  },
];

const TOUR_STEPS = [
  {
    id: "dashboard-overview",
    title: "Welcome to your Financial Dashboard",
    description:
      "This is your control center for managing money like a business.",
    target: ".dashboard-main",
    placement: "center",
  },
  {
    id: "transfers-section",
    title: "Instant Transfers",
    description:
      "💸 Send money instantly anywhere in the world. Click here to transfer funds.",
    target: ".transfer-section",
    placement: "top-left",
  },
  {
    id: "analytics-section",
    title: "AI-Powered Analytics",
    description:
      "📊 Get intelligent insights about your spending patterns and financial health.",
    target: ".analytics-section",
    placement: "top-left",
  },
  {
    id: "settings-section",
    title: "Personalized Settings",
    description:
      "⚙️ Customize themes, notifications, and your financial preferences.",
    target: ".settings-panel",
    placement: "top-right",
  },
];

export default function Onboarding({ onComplete, subscription }) {
  const [currentStep, setCurrentStep] = useState(ONBOARDING_STEPS.INTRO);
  const [completedItems, setCompletedItems] = useState(new Set());
  const [showConfetti, setShowConfetti] = useState(false);
  const [tourProgress, setTourProgress] = useState(0);
  const [animating, setAnimating] = useState(false);

  // Refs for cleanup
  const highlightTimeoutRef = useRef(null);
  const animationTimeoutRef = useRef(null);
  const tourTimeoutRef = useRef(null);

  // Load progress from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("onboardingProgress");
    if (saved) {
      try {
        const { step, completed } = JSON.parse(saved);
        setCurrentStep(step);
        setCompletedItems(new Set(completed));
      } catch (e) {
        console.error("Failed to load onboarding progress:", e);
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
      }
      if (tourTimeoutRef.current) {
        clearTimeout(tourTimeoutRef.current);
      }
    };
  }, []);

  // Save progress to localStorage
  const saveProgress = useCallback((step, completed) => {
    localStorage.setItem(
      "onboardingProgress",
      JSON.stringify({
        step,
        completed: Array.from(completed),
      }),
    );
  }, []);

  // Mark item as completed
  const completeItem = useCallback(
    (itemId) => {
      const newCompleted = new Set(completedItems);
      newCompleted.add(itemId);
      setCompletedItems(newCompleted);
      saveProgress(currentStep, newCompleted);
    },
    [completedItems, currentStep, saveProgress],
  );

  // Navigate between steps with animation
  const nextStep = useCallback(() => {
    setAnimating(true);
    animationTimeoutRef.current = setTimeout(() => {
      if (currentStep === ONBOARDING_STEPS.INTRO) {
        setCurrentStep(ONBOARDING_STEPS.CHECKLIST);
      } else if (currentStep === ONBOARDING_STEPS.CHECKLIST) {
        setCurrentStep(ONBOARDING_STEPS.TOUR);
      } else if (currentStep === ONBOARDING_STEPS.TOUR) {
        setCurrentStep(ONBOARDING_STEPS.FINISH);
        setShowConfetti(true);
      }
      setAnimating(false);
      saveProgress(currentStep, completedItems);
    }, 300);
  }, [currentStep, completedItems, saveProgress]);

  // Skip onboarding entirely
  const skipOnboarding = useCallback(() => {
    onComplete?.();
    localStorage.setItem("onboardingSkipped", "true");
  }, [onComplete]);

  // Complete onboarding
  const completeOnboarding = useCallback(() => {
    localStorage.setItem("onboardingCompleted", "true");
    localStorage.removeItem("onboardingProgress");
    onComplete?.();
  }, [onComplete]);

  // Guide to next tour step
  const guideToNextTourStep = useCallback(() => {
    const currentTourStep = TOUR_STEPS[tourProgress];

    if (currentTourStep) {
      // Highlight the target element
      const targetElement = document.querySelector(currentTourStep.target);
      if (targetElement) {
        targetElement.style.boxShadow = "0 0 0 4px rgba(59, 130, 246, 0.5)";
        targetElement.style.borderRadius = "8px";

        // Scroll into view smoothly
        targetElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });

        // Remove highlight after 3 seconds
        if (highlightTimeoutRef.current) {
          clearTimeout(highlightTimeoutRef.current);
        }
        highlightTimeoutRef.current = setTimeout(() => {
          targetElement.style.boxShadow = "";
          targetElement.style.borderRadius = "";
        }, 3000);
      }
    }

    setTourProgress((prev) => prev + 1);

    if (tourProgress >= TOUR_STEPS.length - 1) {
      // Tour completed
      tourTimeoutRef.current = setTimeout(nextStep, 1000);
    }
  }, [tourProgress, nextStep]);

  // Start guided tour
  const startTour = useCallback(() => {
    setTourProgress(0);
    // Trigger the tour walkthrough
    guideToNextTourStep();
  }, [guideToNextTourStep]);

  // Render intro step
  if (currentStep === ONBOARDING_STEPS.INTRO) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-700 flex items-center justify-center z-50">
        <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-lg mx-4 text-center relative overflow-hidden">
          {/* Animated background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="animate-spin-slow">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="absolute w-32 h-32 border-2 border-yellow-400"
                  style={{
                    top: "50%",
                    left: "50%",
                    transform: `rotate(${i * 45}deg) translate(-50%, -50%)`,
                    borderRadius: "50%",
                  }}
                />
              ))}
            </div>
          </div>

          <div className="relative z-10">
            <div className="text-6xl mb-6 animate-bounce">✨</div>
            <h1 className="text-4xl font-bold text-gray-800 mb-4">
              Welcome to <span className="text-purple-600">VaultBank</span> 💎
            </h1>
            <p className="text-gray-600 mb-6 text-lg">
              Your luxury financial platform for serious wealth management.
            </p>
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black px-6 py-3 rounded-xl font-semibold mb-6 shadow-lg">
              Premium Features Ready 🎯
            </div>
            <button
              onClick={nextStep}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-8 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
            >
              Start Tour 🚀
            </button>
            <button
              onClick={skipOnboarding}
              className="block mx-auto mt-4 text-gray-500 hover:text-gray-700 transition-colors"
            >
              Skip Tour →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render checklist step
  if (currentStep === ONBOARDING_STEPS.CHECKLIST) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div
          className={`bg-white rounded-3xl shadow-2xl p-8 max-w-2xl mx-4 transform transition-all duration-300 ${
            animating ? "scale-95 opacity-0" : "scale-100 opacity-100"
          }`}
        >
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-800 mb-2">
              🎯 Your Journey Begins
            </h2>
            <p className="text-gray-600">
              Complete these steps to master your finances
            </p>
          </div>

          <div className="space-y-4 mb-8">
            {CHECKLIST_ITEMS.map((item) => (
              <div
                key={item.id}
                className={`flex items-center p-4 rounded-xl border-2 transition-all duration-300 cursor-pointer ${
                  completedItems.has(item.id)
                    ? "bg-green-50 border-green-300"
                    : "bg-gray-50 border-gray-200 hover:border-purple-300"
                }`}
                onClick={() => completeItem(item.id)}
              >
                <span
                  className={`text-2xl mr-4 ${
                    completedItems.has(item.id) ? "animate-bounce" : ""
                  }`}
                >
                  {item.icon}
                </span>
                <span
                  className={`flex-1 text-lg ${
                    completedItems.has(item.id)
                      ? "line-through text-gray-500"
                      : "text-gray-800"
                  }`}
                >
                  {item.label}
                </span>
                {completedItems.has(item.id) ? (
                  <span className="text-green-500 text-xl">✓</span>
                ) : (
                  <span className="text-gray-400">○</span>
                )}
              </div>
            ))}
          </div>

          <div className="text-center">
            <div className="bg-gray-200 rounded-full h-3 mb-4 overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full transition-all duration-500"
                style={{
                  width: `${
                    (completedItems.size / CHECKLIST_ITEMS.length) * 100
                  }%`,
                }}
              />
            </div>
            <span className="text-gray-600">
              {completedItems.size} / {CHECKLIST_ITEMS.length} steps completed
            </span>
          </div>

          <div className="flex space-x-4 mt-8">
            <button
              onClick={nextStep}
              disabled={completedItems.size === 0}
              className={`flex-1 py-3 rounded-xl font-semibold transition-all duration-300 ${
                completedItems.size > 0
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:shadow-lg hover:scale-105"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
            >
              Continue Tour →
            </button>
            <button
              onClick={skipOnboarding}
              className="px-6 py-3 text-gray-500 hover:text-gray-700 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render tour step
  if (currentStep === ONBOARDING_STEPS.TOUR) {
    const currentTourStep = TOUR_STEPS[tourProgress];

    return (
      <div
        className={`fixed inset-0 z-50 ${
          animating ? "animate-fade-out" : "animate-fade-in"
        }`}
      >
        {/* Guided Tour Overlay */}
        {currentTourStep && (
          <>
            <div
              className="fixed inset-0 bg-black/60 cursor-pointer"
              onClick={guideToNextTourStep}
            />
            <div
              className={`fixed z-10 bg-white rounded-2xl shadow-2xl p-6 max-w-sm ${
                currentTourStep.placement === "top-left"
                  ? "top-20 left-4"
                  : currentTourStep.placement === "top-right"
                    ? "top-20 right-4"
                    : "top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
              }`}
            >
              <h3 className="text-2xl font-bold text-gray-800 mb-2">
                {currentTourStep.title}
              </h3>
              <p className="text-gray-600 mb-4">
                {currentTourStep.description}
              </p>
              <button
                onClick={guideToNextTourStep}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-6 py-2 rounded-xl font-semibold hover:shadow-lg transition-all duration-300"
              >
                {tourProgress >= TOUR_STEPS.length - 1
                  ? "Finish Tour"
                  : "Next →"}
              </button>
            </div>
          </>
        )}

        {/* Start Tour Button */}
        {tourProgress === 0 && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md mx-4 text-center">
              <div className="text-5xl mb-4">🎭</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-4">
                Interactive Tour
              </h2>
              <p className="text-gray-600 mb-6">
                Let me guide you through the powerful features of VaultBank
                Premium
              </p>
              <button
                onClick={startTour}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-8 py-3 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105"
              >
                Start Interactive Tour 🎯
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Render finish step
  if (currentStep === ONBOARDING_STEPS.FINISH) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-green-500 via-blue-600 to-purple-700 flex items-center justify-center z-50">
        {showConfetti && (
          <Confetti
            width={window.innerWidth}
            height={window.innerHeight}
            recycle={false}
            numberOfPieces={500}
          />
        )}

        <div
          className={`bg-white rounded-3xl shadow-2xl p-8 max-w-lg mx-4 text-center transform transition-all duration-300 ${
            animating ? "scale-95 opacity-0" : "scale-100 opacity-100"
          }`}
        >
          <div className="text-6xl mb-6 animate-bounce">🎉</div>
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            Congratulations! 🎊🎉
          </h1>
          <p className="text-gray-600 mb-6 text-lg">
            You now have the power to master your finances like never before!
          </p>

          {subscription === "premium" || subscription === "trial" ? (
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-black px-6 py-3 rounded-xl font-semibold mb-6 shadow-lg">
              ✨ Premium Mode Unlocked — Your Financial Journey Begins! 💎
            </div>
          ) : (
            <div className="bg-gradient-to-r from-blue-400 to-purple-500 text-white px-6 py-3 rounded-xl font-semibold mb-6 shadow-lg">
              🚀 Ready to unlock Premium features? Upgrade for advanced
              insights!
            </div>
          )}

          <div className="space-y-2 mb-8 text-left bg-gray-50 p-4 rounded-xl">
            <div className="flex items-center space-x-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-700">
                AI-powered financial insights
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-700">
                Smart budget tracking & alerts
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-700">Personalized savings goals</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-700">
                Premium analytics & reporting
              </span>
            </div>
          </div>

          <button
            onClick={completeOnboarding}
            className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-8 py-4 rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-105 w-full"
          >
            Enter VaultBank Dashboard 🌟
          </button>
        </div>
      </div>
    );
  }

  return null;
}
