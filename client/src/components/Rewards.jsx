import { useState, useEffect } from "react";
import {
  FaTrophy,
  FaCoins,
  FaGift,
  FaCreditCard,
  FaCrown,
  FaGem,
  FaMedal,
} from "react-icons/fa";

export default function Rewards({ subscription }) {
  const [rewardsData, setRewardsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [redeeming, setRedeeming] = useState(false);

  // Fetch rewards data
  const fetchRewards = async () => {
    try {
      const response = await fetch("/api/rewards/me", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();
      if (data.success) {
        setRewardsData(data.data);
        setError(null);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError("Failed to load rewards data");
      console.error("Rewards fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRewards();
  }, []);

  // Handle point redemption
  const handleRedeem = async (points, rewardType) => {
    setRedeeming(true);
    try {
      const response = await fetch("/api/rewards/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          userId: JSON.parse(atob(localStorage.getItem("token").split(".")[1]))
            ._id,
          points,
          rewardType,
          description: `Redeemed ${points} points for ${rewardType}`,
        }),
      });

      const data = await response.json();
      if (data.success) {
        alert(`🎉 ${data.data.message}`);
        fetchRewards(); // Refresh data
      } else {
        alert(`❌ ${data.message}`);
      }
    } catch (err) {
      alert("❌ Failed to redeem points. Please try again.");
      console.error("Redemption error:", err);
    } finally {
      setRedeeming(false);
    }
  };

  // Get tier colors and icons
  const getTierStyle = (tier) => {
    switch (tier) {
      case "Silver":
        return {
          bg: "from-gray-500 to-gray-600",
          text: "text-gray-300",
          icon: <FaMedal className="text-gray-300" />,
          ring: "ring-gray-500",
        };
      case "Gold":
        return {
          bg: "from-yellow-500 to-yellow-600",
          text: "text-yellow-300",
          icon: <FaTrophy className="text-yellow-300" />,
          ring: "ring-yellow-500",
        };
      case "Platinum":
        return {
          bg: "from-purple-600 to-purple-700",
          text: "text-purple-300",
          icon: <FaGem className="text-purple-300" />,
          ring: "ring-purple-500",
        };
      default:
        return {
          bg: "from-gray-500 to-gray-600",
          text: "text-gray-300",
          icon: <FaMedal className="text-gray-300" />,
          ring: "ring-gray-500",
        };
    }
  };

  // Get tier benefits
  const getTierBenefits = (tier) => {
    const baseBenefits = [
      "💰 1 point per ₹100 spent",
      "🎯 200 points for goal completion",
      "👥 500 points for referral success",
    ];

    switch (tier) {
      case "Silver":
        return [...baseBenefits, "📊 Basic transaction history"];
      case "Gold":
        return [
          ...baseBenefits,
          "⭐ 5% bonus points",
          "🔔 Priority notifications",
          "📈 Enhanced insights",
        ];
      case "Platinum":
        return [
          ...baseBenefits,
          "⭐ 10% bonus points",
          "👑 Exclusive perks",
          "🎁 Special offers",
          "💎 Luxury support",
        ];
      default:
        return baseBenefits;
    }
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 text-white p-6 rounded-xl shadow-xl">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
          <p>Loading your rewards...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-to-br from-red-900/50 to-red-800/50 text-white p-6 rounded-xl shadow-xl">
        <div className="text-center">
          <p className="text-red-300">❌ {error}</p>
          <button
            onClick={fetchRewards}
            className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { points, tier, totalEarned, totalRedeemed, tierProgress, history } =
    rewardsData;
  const tierStyle = getTierStyle(tier);
  const tierBenefits = getTierBenefits(tier);

  return (
    <div className="space-y-6">
      {/* Main Rewards Card */}
      <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 text-white p-6 rounded-xl shadow-xl">
        <div className="text-center mb-6">
          <h2 className="text-3xl font-bold mb-2">🎁 VaultBank Rewards</h2>
          <p className="text-blue-200">
            Earn points for financial milestones and redeem for rewards!
          </p>
        </div>

        {/* Current Tier & Points */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Points Balance */}
          <div className="bg-black/30 rounded-lg p-6 text-center">
            <FaCoins className="text-yellow-400 text-4xl mx-auto mb-2" />
            <div className="text-3xl font-bold text-yellow-400">
              {points.toLocaleString()}
            </div>
            <div className="text-blue-200 mb-2">Reward Points</div>
            <div className="flex justify-center space-x-4 text-sm">
              <div className="text-green-400">
                +{totalEarned.toLocaleString()} earned
              </div>
              <div className="text-red-400">
                -{totalRedeemed.toLocaleString()} redeemed
              </div>
            </div>
          </div>

          {/* Current Tier */}
          <div
            className={`bg-gradient-to-br ${tierStyle.bg} rounded-lg p-6 text-center ring-2 ${tierStyle.ring}`}
          >
            <div className="text-4xl mb-2">{tierStyle.icon}</div>
            <div className={`text-xl font-bold mb-1 ${tierStyle.text}`}>
              {tier} Tier
            </div>
            <div className="text-white/80 text-sm">
              Exclusive Member Benefits
            </div>
            <div className="mt-3 text-xs text-white/60">
              Membership since{" "}
              {tierProgress?.lastTierUpgrade
                ? new Date(tierProgress.lastTierUpgrade).toLocaleDateString()
                : "Getting Started"}
            </div>
          </div>
        </div>

        {/* Tier Progress */}
        {tierProgress && tierProgress.nextTier && (
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span>Progress to {tierProgress.nextTier}</span>
              <span>{tierProgress.pointsToNext} points needed</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
              <div
                className="bg-gradient-to-r from-yellow-400 to-yellow-600 h-full transition-all duration-500"
                style={{ width: `${Math.min(tierProgress.progress, 100)}%` }}
              ></div>
            </div>
            <div className="text-center text-xs text-gray-400 mt-1">
              {tierProgress.progress.toFixed(0)}% complete
            </div>
          </div>
        )}

        {/* Tier Benefits */}
        <div className="mb-8">
          <h3 className="text-xl font-bold mb-4 text-center">
            {tier} Tier Benefits
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            {tierBenefits.map((benefit, index) => (
              <div key={index} className="bg-black/20 rounded-lg p-3 text-sm">
                {benefit}
              </div>
            ))}
          </div>
        </div>

        {/* Marketplace Button */}
        <div className="border-t border-white/20 pt-6 mb-6">
          <button
            onClick={() => (window.location.hash = "#marketplace")}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white py-4 px-6 rounded-xl font-bold text-lg transition-all duration-300 hover:scale-105 shadow-lg hover:shadow-xl"
          >
            🏪 Visit Marketplace - Shop with Points! 🪙
          </button>
          <p className="text-center text-blue-200 text-sm mt-2">
            Redeem premium vouchers, services, and exclusive items
          </p>
        </div>

        {/* Redemption Section */}
        <div className="border-t border-white/20 pt-6">
          <h3 className="text-xl font-bold mb-4 text-center">
            🎁 Redeem Rewards
          </h3>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Cashback Redemption */}
            <div className="bg-gradient-to-r from-green-600/30 to-blue-600/30 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <FaCreditCard className="text-green-400" />
                  <span className="font-semibold">Cashback Reward</span>
                </div>
                <div className="text-yellow-400 font-bold">1000 pts</div>
              </div>
              <p className="text-sm text-gray-300 mb-3">
                Get ₹100 credited to your account
              </p>
              <button
                onClick={() => handleRedeem(1000, "cashback")}
                disabled={points < 1000 || redeeming}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white py-2 rounded-lg transition-colors disabled:cursor-not-allowed"
              >
                {redeeming ? "Redeeming..." : "Redeem ₹100"}
              </button>
            </div>

            {/* Premium Perks */}
            {tier === "Platinum" && (
              <div className="bg-gradient-to-r from-purple-600/30 to-pink-600/30 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <FaCrown className="text-purple-400" />
                    <span className="font-semibold">Premium Perk</span>
                  </div>
                  <div className="text-yellow-400 font-bold">800 pts</div>
                </div>
                <p className="text-sm text-gray-300 mb-3">
                  Exclusive luxury banking perk
                </p>
                <button
                  onClick={() => handleRedeem(800, "perk")}
                  disabled={points < 800 || redeeming}
                  className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white py-2 rounded-lg transition-colors disabled:cursor-not-allowed"
                >
                  {redeeming ? "Redeeming..." : "Claim Perk"}
                </button>
              </div>
            )}
          </div>

          {points < 1000 && (
            <div className="text-center text-gray-400 text-sm mt-4">
              Need {Math.max(0, 1000 - points)} more points to redeem cashback
            </div>
          )}
        </div>
      </div>

      {/* Recent History */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6">
        <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
          📋 Recent Activity
        </h3>

        {history && history.length > 0 ? (
          <div className="space-y-3">
            {history.slice(0, 10).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      item.action === "transaction"
                        ? "bg-blue-600"
                        : item.action === "referral"
                        ? "bg-green-600"
                        : item.action === "goal"
                        ? "bg-purple-600"
                        : item.action === "redeem"
                        ? "bg-red-600"
                        : "bg-gray-600"
                    }`}
                  >
                    {item.action === "transaction" && (
                      <span className="text-white text-xs">💸</span>
                    )}
                    {item.action === "referral" && (
                      <span className="text-white text-xs">👥</span>
                    )}
                    {item.action === "goal" && (
                      <span className="text-white text-xs">🎯</span>
                    )}
                    {item.action === "redeem" && (
                      <span className="text-white text-xs">🎁</span>
                    )}
                    {item.action === "tier_upgrade" && (
                      <FaTrophy className="text-yellow-400 text-sm" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {item.description}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(item.createdAt).toLocaleDateString()} • {tier}{" "}
                      Tier
                    </div>
                  </div>
                </div>
                <div
                  className={`font-semibold ${
                    item.points > 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {item.points > 0 ? "+" : ""}
                  {item.points}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">
            <FaGift className="text-4xl mx-auto mb-2 opacity-50" />
            <p>No rewards activity yet</p>
            <p className="text-sm">
              Start earning points by making transactions!
            </p>
          </div>
        )}

        {history && history.length > 10 && (
          <button className="w-full mt-4 py-2 text-blue-600 hover:text-blue-800 font-medium">
            View All History
          </button>
        )}
      </div>

      {/* How to Earn More */}
      <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 dark:from-blue-600/20 dark:to-purple-600/20 rounded-xl p-6 border border-blue-500/20">
        <h3 className="text-xl font-bold mb-4 text-center text-gray-900 dark:text-white">
          🚀 How to Earn More Points
        </h3>

        <div className="grid md:grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-3xl mb-2">💳</div>
            <div className="font-semibold mb-1">Transactions</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              1 point per ₹100 spent
            </div>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">👥</div>
            <div className="font-semibold mb-1">Referrals</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              500 points when friends join
            </div>
          </div>
          <div className="text-center">
            <div className="text-3xl mb-2">🎯</div>
            <div className="font-semibold mb-1">Goals</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              200 points per goal completed
            </div>
          </div>
        </div>

        <div className="text-center mt-4">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Higher tiers get bonus points (Gold: +5%, Platinum: +10%)
          </div>
        </div>
      </div>
    </div>
  );
}
