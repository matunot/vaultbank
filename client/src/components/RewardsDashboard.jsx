import React, { useState, useEffect } from "react";
import {
  Trophy,
  Star,
  CreditCard,
  Gift,
  DollarSign,
  TrendingUp,
  Calendar,
  PieChart,
  ChefHat,
  ShoppingBag,
  Crown,
} from "lucide-react";
import api from "../utils/api";

const RewardsDashboard = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [rewardsData, setRewardsData] = useState(null);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load rewards data on mount and when tab changes
  useEffect(() => {
    loadRewardsData();
    if (activeTab === "rules") {
      loadRules();
    }
  }, [activeTab]);

  // Auto-refresh every 30 seconds for overview tab
  useEffect(() => {
    if (activeTab === "overview") {
      const interval = setInterval(loadRewardsData, 30000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const loadRewardsData = async () => {
    try {
      setLoading(true);
      const response = await api.get("/rewards/me");
      setRewardsData(response.data.data);
      setError("");
    } catch (error) {
      console.error("Error loading rewards:", error);
      setError("Failed to load rewards data");
    } finally {
      setLoading(false);
    }
  };

  const loadRules = async () => {
    try {
      const response = await api.get("/rewards/rules");
      setRules(response.data.rules || []);
    } catch (error) {
      console.error("Error loading rules:", error);
    }
  };

  const getTierIcon = (tier) => {
    switch (tier) {
      case "Platinum":
        return <Crown className="h-5 w-5 text-blue-600" />;
      case "Gold":
        return <Star className="h-5 w-5 text-yellow-600" />;
      default:
        return <Trophy className="h-5 w-5 text-gray-600" />;
    }
  };

  const getTierColor = (tier) => {
    switch (tier) {
      case "Platinum":
        return "bg-blue-50 border-blue-200 text-blue-800";
      case "Gold":
        return "bg-yellow-50 border-yellow-200 text-yellow-800";
      default:
        return "bg-gray-50 border-gray-200 text-gray-800";
    }
  };

  const OverviewTab = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center py-12">
          <div className="text-red-600 mb-2">⚠️</div>
          <p className="text-red-600">{error}</p>
        </div>
      );
    }

    const {
      points,
      cashbackAmount,
      tier,
      tierProgress,
      totalEarnedPoints,
      totalEarnedCashback,
    } = rewardsData;

    return (
      <div className="space-y-6">
        {/* Main Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Points Card */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Reward Points
                </p>
                <p className="text-3xl font-bold text-gray-900">
                  {points?.toLocaleString()}
                </p>
                <p className="text-sm text-gray-500">
                  Earned: {totalEarnedPoints?.toLocaleString()}
                </p>
              </div>
              <Gift className="h-12 w-12 text-green-600 opacity-20" />
            </div>
          </div>

          {/* Cashback Card */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Cashback Balance
                </p>
                <p className="text-3xl font-bold text-gray-900">
                  ${cashbackAmount?.toFixed(2)}
                </p>
                <p className="text-sm text-gray-500">
                  Earned: ${totalEarnedCashback?.toFixed(2)}
                </p>
              </div>
              <DollarSign className="h-12 w-12 text-blue-600 opacity-20" />
            </div>
          </div>

          {/* Tier Card */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Current Tier
                </p>
                <div
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getTierColor(
                    tier
                  )}`}
                >
                  {getTierIcon(tier)}
                  <span className="ml-2">{tier}</span>
                </div>
              </div>
              <PieChart className="h-12 w-12 text-purple-600 opacity-20" />
            </div>

            {/* Bonus Indicator */}
            {tier === "Gold" && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mt-4">
                <p className="text-sm text-yellow-800">
                  🌟 Gold tier bonus: +10% extra rewards on all transactions
                </p>
              </div>
            )}
            {tier === "Platinum" && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mt-4">
                <p className="text-sm text-blue-800">
                  👑 Platinum tier benefits: Maximum rewards and premium perks
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Tier Progress */}
        {(tier === "Silver" || tier === "Gold") && tierProgress && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                Tier Progress
              </h3>
              {tier === "Gold" && (
                <span className="text-sm text-yellow-600">Next: Platinum</span>
              )}
              {tier === "Silver" && (
                <span className="text-sm text-gray-600">Next: Gold</span>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>{tier} Tier</span>
                <span>
                  {tier === "Gold"
                    ? `${(
                        (tierProgress.progress * (15000 - 5000)) / 100 +
                        5000
                      ).toFixed(0)}/${15000} pts`
                    : `${((tierProgress.progress * 5000) / 100).toFixed(
                        0
                      )}/${5000} pts`}
                </span>
              </div>

              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full ${
                    tier === "Gold" ? "bg-yellow-500" : "bg-gray-400"
                  }`}
                  style={{ width: `${tierProgress.progress}%` }}
                ></div>
              </div>

              <p className="text-xs text-gray-500">
                {tierProgress.pointsToNext > 0
                  ? `${tierProgress.pointsToNext.toLocaleString()} more points to next tier`
                  : "Maximum tier reached!"}
              </p>
            </div>
          </div>
        )}

        {/* Quick Stats */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h3 className="text-lg font-medium text-gray-900 mb-4">This Month</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600">
                {totalEarnedPoints - (rewardsData.totalRedeemedPoints || 0)}
              </p>
              <p className="text-sm text-gray-600">Points Earned</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-blue-600">
                ${totalEarnedCashback?.toFixed(2)}
              </p>
              <p className="text-sm text-gray-600">Cashback</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-purple-600">
                {rewardsData.history?.filter((h) => {
                  const date = new Date(h.createdAt);
                  const now = new Date();
                  return (
                    date.getMonth() === now.getMonth() &&
                    date.getFullYear() === now.getFullYear()
                  );
                }).length || 0}
              </p>
              <p className="text-sm text-gray-600">Rewards</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-orange-600">
                {tier === "Gold" ? "+10%" : "Standard"}
              </p>
              <p className="text-sm text-gray-600">Bonus Rate</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const HistoryTab = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    const history = rewardsData?.history || [];

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">
              Rewards History
            </h3>
            <p className="text-sm text-gray-600">
              Track your earned rewards over time
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Transaction
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reward Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {history.length === 0 ? (
                  <tr>
                    <td
                      colSpan="5"
                      className="px-6 py-4 text-center text-gray-500"
                    >
                      No rewards earned yet. Make your first transaction to
                      start earning!
                    </td>
                  </tr>
                ) : (
                  history.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">
                          {new Date(item.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-sm text-gray-500">
                          {new Date(item.createdAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {item.transactionId ? "Transaction" : "Bonus"}
                        </div>
                        <div className="text-sm text-gray-500">
                          {item.transactionId
                            ? `#${item.transactionId.substring(0, 8)}...`
                            : "System"}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          {item.points > 0 ? (
                            <Gift className="h-4 w-4 text-green-600 mr-2" />
                          ) : (
                            <CreditCard className="h-4 w-4 text-blue-600 mr-2" />
                          )}
                          <span className="text-sm text-gray-900">
                            {item.points > 0 ? "Points" : "Cashback"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div
                          className={`text-sm font-medium ${
                            item.points > 0 ? "text-green-600" : "text-blue-600"
                          }`}
                        >
                          {item.points > 0
                            ? `+${item.points} pts`
                            : `$${item.cashbackAmount?.toFixed(2)}`}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-900 max-w-xs truncate">
                          {item.description}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const RulesTab = () => {
    const ruleIcons = {
      dining: <ChefHat className="h-6 w-6" />,
      shopping: <ShoppingBag className="h-6 w-6" />,
      transfer: <TrendingUp className="h-6 w-6" />,
    };

    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Active Reward Programs
          </h3>
          <p className="text-sm text-gray-600">
            Earn points and cashback on all your transactions
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center">
                  <div
                    className={`p-2 rounded-lg ${
                      rule.reward_type === "points"
                        ? "bg-green-100 text-green-600"
                        : rule.reward_type === "cashback"
                        ? "bg-blue-100 text-blue-600"
                        : "bg-purple-100 text-purple-600"
                    }`}
                  >
                    {rule.name.toLowerCase().includes("dining")
                      ? ruleIcons.dining
                      : rule.name.toLowerCase().includes("shopping")
                      ? ruleIcons.shopping
                      : ruleIcons.transfer}
                  </div>
                  <div className="ml-3">
                    <h4 className="text-lg font-semibold text-gray-900">
                      {rule.name}
                    </h4>
                    <p className="text-sm text-gray-600">{rule.description}</p>
                  </div>
                </div>
                <div
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    rule.reward_type === "points"
                      ? "bg-green-100 text-green-800"
                      : rule.reward_type === "cashback"
                      ? "bg-blue-100 text-blue-800"
                      : "bg-purple-100 text-purple-800"
                  }`}
                >
                  {rule.reward_type === "points"
                    ? "Points"
                    : rule.reward_type === "cashback"
                    ? "Cashback"
                    : "Tier Upgrade"}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">
                    Reward:
                  </span>
                  <span
                    className={`text-xl font-bold ${
                      rule.reward_type === "points"
                        ? "text-green-600"
                        : rule.reward_type === "cashback"
                        ? "text-blue-600"
                        : "text-purple-600"
                    }`}
                  >
                    {rule.reward_type === "points"
                      ? `${rule.value}x points`
                      : rule.reward_type === "cashback"
                      ? `${(rule.value * 100).toFixed(0)}% cashback`
                      : `${rule.value}x tier upgrade`}
                  </span>
                </div>

                <div className="pt-3 border-t border-gray-200">
                  <p className="text-xs text-gray-500">
                    Applies to tiers: {rule.tier_eligibility.join(", ")}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* How It Works */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 border border-blue-200">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <Star className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-3">
              <h4 className="text-sm font-medium text-blue-900">
                How Rewards Work
              </h4>
              <div className="mt-2 text-sm text-blue-700">
                <ul className="list-disc list-inside space-y-1">
                  <li>
                    Points are earned on eligible transactions and can be
                    redeemed for rewards
                  </li>
                  <li>Cashback is credited directly to your reward balance</li>
                  <li>
                    Higher tiers earn bonus rewards and unlock exclusive perks
                  </li>
                  <li>
                    All rewards are automatically applied when you complete
                    transactions
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center space-x-3 mb-4">
          <Trophy className="h-8 w-8 text-yellow-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Rewards & Loyalty
            </h1>
            <p className="text-gray-600">
              Track your rewards, progress, and rewards programs
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab("overview")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === "overview"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <CreditCard className="inline h-5 w-5 mr-2" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === "history"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Calendar className="inline h-5 w-5 mr-2" />
              History
            </button>
            <button
              onClick={() => setActiveTab("rules")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === "rules"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Star className="inline h-5 w-5 mr-2" />
              Reward Programs
            </button>
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "history" && <HistoryTab />}
      {activeTab === "rules" && <RulesTab />}
    </div>
  );
};

export default RewardsDashboard;
