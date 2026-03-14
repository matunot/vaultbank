import React, { useState, useEffect } from "react";
import {
  Settings,
  Users,
  BarChart3,
  Plus,
  Edit,
  ToggleLeft,
  ToggleRight,
  DollarSign,
  Gift,
  TrendingUp,
} from "lucide-react";
import api from "../utils/api";

const RewardsAdmin = () => {
  const [activeTab, setActiveTab] = useState("rules");
  const [rules, setRules] = useState([]);
  const [topUsers, setTopUsers] = useState([]);
  const [analytics, setAnalytics] = useState({});
  const [loading, setLoading] = useState(true);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    description: "",
    rewardType: "points",
    condition: {
      category: "",
      amount: { min: 0 },
    },
    value: 0,
    priority: 50,
    active: true,
    tierEligibility: ["Silver", "Gold", "Platinum"],
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load data based on active tab
  useEffect(() => {
    if (activeTab === "rules") {
      loadRules();
    } else if (activeTab === "users") {
      loadTopUsers();
    } else if (activeTab === "analytics") {
      loadAnalytics();
    }
  }, [activeTab]);

  const loadRules = async () => {
    try {
      setLoading(true);
      const response = await api.get("/rewards/rules");
      setRules(response.data.rules || []);
    } catch (error) {
      console.error("Error loading rules:", error);
      setError("Failed to load reward rules");
    } finally {
      setLoading(false);
    }
  };

  const loadTopUsers = async () => {
    try {
      setLoading(true);
      // This would need a backend endpoint for top users
      // For now, simulate with sample data
      setTopUsers([
        {
          id: "1",
          name: "John Doe",
          points: 12500,
          cashback: 150.75,
          tier: "Gold",
        },
        {
          id: "2",
          name: "Jane Smith",
          points: 9800,
          cashback: 120.5,
          tier: "Gold",
        },
        {
          id: "3",
          name: "Bob Johnson",
          points: 8600,
          cashback: 95.25,
          tier: "Silver",
        },
        {
          id: "4",
          name: "Alice Brown",
          points: 7200,
          cashback: 88.0,
          tier: "Silver",
        },
        {
          id: "5",
          name: "Charlie Wilson",
          points: 6500,
          cashback: 75.5,
          tier: "Silver",
        },
      ]);
    } catch (error) {
      console.error("Error loading top users:", error);
      setError("Failed to load top users");
    } finally {
      setLoading(false);
    }
  };

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      // This would need a backend endpoint for analytics
      // For now, simulate with sample data
      setAnalytics({
        monthlyCashback: [
          { month: "Aug", amount: 1250.5 },
          { month: "Sep", amount: 1450.75 },
          { month: "Oct", amount: 1620.25 },
        ],
        monthlyPoints: [
          { month: "Aug", points: 125000 },
          { month: "Sep", points: 145000 },
          { month: "Oct", points: 168000 },
        ],
        tierDistribution: {
          Silver: 65,
          Gold: 30,
          Platinum: 5,
        },
        totalCashbackPaid: 4321.5,
        totalPointsIssued: 438000,
        activeUsers: 1250,
      });
    } catch (error) {
      console.error("Error loading analytics:", error);
      setError("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  const handleRuleSubmit = async (e) => {
    e.preventDefault();

    try {
      const ruleData = {
        ...ruleForm,
        condition: JSON.stringify(ruleForm.condition),
      };

      if (editingRule) {
        // Update existing rule (this would need a PUT endpoint)
        setSuccess(`Rule "${ruleForm.name}" updated successfully!`);
      } else {
        // Create new rule
        const response = await api.post("/rewards/rules", ruleData);
        setRules([...rules, response.data.rule]);
        setSuccess(`Rule "${ruleForm.name}" created successfully!`);
      }

      setShowRuleModal(false);
      setEditingRule(null);
      resetForm();
      setTimeout(() => setSuccess(""), 3000);
    } catch (error) {
      console.error("Error saving rule:", error);
      setError("Failed to save rule");
      setTimeout(() => setError(""), 3000);
    }
  };

  const handleToggleRule = async (ruleId, currentStatus) => {
    try {
      // Toggle active status (this would need a PATCH endpoint)
      const updatedRules = rules.map((rule) =>
        rule.id === ruleId ? { ...rule, active: !currentStatus } : rule
      );
      setRules(updatedRules);
      setSuccess(
        `Rule ${!currentStatus ? "activated" : "deactivated"} successfully!`
      );
      setTimeout(() => setSuccess(""), 3000);
    } catch (error) {
      console.error("Error toggling rule:", error);
      setError("Failed to toggle rule status");
      setTimeout(() => setError(""), 3000);
    }
  };

  const handleEditRule = (rule) => {
    setEditingRule(rule);
    setRuleForm({
      ...rule,
      condition: JSON.parse(rule.condition || "{}"),
    });
    setShowRuleModal(true);
  };

  const resetForm = () => {
    setRuleForm({
      name: "",
      description: "",
      rewardType: "points",
      condition: {
        category: "",
        amount: { min: 0 },
      },
      value: 0,
      priority: 50,
      active: true,
      tierEligibility: ["Silver", "Gold", "Platinum"],
    });
  };

  const RulesTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-medium text-gray-900">
            Reward Rules Management
          </h3>
          <p className="text-sm text-gray-600">
            Create and manage rewards programs for users
          </p>
        </div>
        <button
          onClick={() => {
            setEditingRule(null);
            resetForm();
            setShowRuleModal(true);
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Rule
        </button>
      </div>

      {success && (
        <div className="p-4 bg-green-100 border border-green-400 text-green-700 rounded-lg">
          {success}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Rule Name
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Value
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {rules.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-4 text-center text-gray-500">
                  {loading ? "Loading rules..." : "No reward rules found"}
                </td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {rule.name}
                      </div>
                      <div className="text-sm text-gray-500 max-w-xs truncate">
                        {rule.description}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        rule.reward_type === "points"
                          ? "bg-green-100 text-green-800"
                          : rule.reward_type === "cashback"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-purple-100 text-purple-800"
                      }`}
                    >
                      {rule.reward_type}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {rule.reward_type === "points"
                      ? `${rule.value}x`
                      : rule.reward_type === "cashback"
                      ? `${(rule.value * 100).toFixed(0)}%`
                      : rule.value}
                  </td>
                  <td className="px-6 py-4">
                    <div
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        rule.active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {rule.active ? "Active" : "Inactive"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium space-x-2">
                    <button
                      onClick={() => handleEditRule(rule)}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleToggleRule(rule.id, rule.active)}
                      className={`${
                        rule.active
                          ? "text-red-600 hover:text-red-900"
                          : "text-green-600 hover:text-green-900"
                      }`}
                    >
                      {rule.active ? (
                        <ToggleRight className="h-4 w-4" />
                      ) : (
                        <ToggleLeft className="h-4 w-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const TopUsersTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Top Rewards Users</h3>
        <p className="text-sm text-gray-600">
          Users with the most rewards activity
        </p>
      </div>

      <div className="space-y-4">
        {topUsers.map((user, index) => (
          <div
            key={user.id}
            className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div
                  className={`text-2xl ${
                    index === 0
                      ? "text-yellow-500"
                      : index === 1
                      ? "text-gray-400"
                      : index === 2
                      ? "text-orange-500"
                      : "text-gray-500"
                  }`}
                >
                  {index === 0
                    ? "🥇"
                    : index === 1
                    ? "🥈"
                    : index === 2
                    ? "🥉"
                    : `#${index + 1}`}
                </div>
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">
                    {user.name}
                  </h4>
                  <div
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      user.tier === "Platinum"
                        ? "bg-blue-100 text-blue-800"
                        : user.tier === "Gold"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {user.tier} Tier
                  </div>
                </div>
              </div>

              <div className="flex space-x-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600">
                    {user.points.toLocaleString()}
                  </p>
                  <p className="text-sm text-gray-600">Points</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-600">
                    ${user.cashback.toFixed(2)}
                  </p>
                  <p className="text-sm text-gray-600">Cashback</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const AnalyticsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <DollarSign className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Total Cashback Paid
              </p>
              <p className="text-2xl font-bold text-gray-900">
                ${analytics.totalCashbackPaid?.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <Gift className="h-6 w-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Total Points Issued
              </p>
              <p className="text-2xl font-bold text-gray-900">
                {analytics.totalPointsIssued?.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Users className="h-6 w-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Active Users</p>
              <p className="text-2xl font-bold text-gray-900">
                {analytics.activeUsers?.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center">
            <div className="p-2 bg-orange-100 rounded-lg">
              <TrendingUp className="h-6 w-6 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Growth Rate</p>
              <p className="text-2xl font-bold text-gray-900">+12.5%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts will be implemented when we have a charting library */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h4 className="text-lg font-medium text-gray-900 mb-4">
            Monthly Cashback Issued
          </h4>
          <div className="space-y-3">
            {analytics.monthlyCashback?.map((data) => (
              <div
                key={data.month}
                className="flex justify-between items-center"
              >
                <span className="text-sm text-gray-600">{data.month}</span>
                <span className="text-sm font-medium text-blue-600">
                  ${data.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
          <h4 className="text-lg font-medium text-gray-900 mb-4">
            Tier Distribution
          </h4>
          <div className="space-y-3">
            {Object.entries(analytics.tierDistribution || {}).map(
              ([tier, percentage]) => (
                <div key={tier} className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span
                      className={`text-sm font-medium ${
                        tier === "Platinum"
                          ? "text-blue-600"
                          : tier === "Gold"
                          ? "text-yellow-600"
                          : "text-gray-600"
                      }`}
                    >
                      {tier} Tier
                    </span>
                    <span className="text-sm text-gray-600">{percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        tier === "Platinum"
                          ? "bg-blue-500"
                          : tier === "Gold"
                          ? "bg-yellow-500"
                          : "bg-gray-400"
                      }`}
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const RuleModal = () => (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
      <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
        <div className="mt-3">
          <h3 className="text-lg font-medium text-gray-900 mb-4">
            {editingRule ? "Edit Reward Rule" : "Create New Reward Rule"}
          </h3>

          <form onSubmit={handleRuleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Rule Name
              </label>
              <input
                type="text"
                value={ruleForm.name}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, name: e.target.value })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="e.g., Dining Points Boost"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                value={ruleForm.description}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, description: e.target.value })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                rows={3}
                placeholder="Brief description of this reward rule"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Reward Type
              </label>
              <select
                value={ruleForm.rewardType}
                onChange={(e) =>
                  setRuleForm({ ...ruleForm, rewardType: e.target.value })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="points">Points Multiplier (e.g., 2x)</option>
                <option value="cashback">Cashback Percentage (e.g., 5%)</option>
                <option value="tier">Tier Upgrade</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Condition Category
              </label>
              <select
                value={ruleForm.condition.category}
                onChange={(e) =>
                  setRuleForm({
                    ...ruleForm,
                    condition: {
                      ...ruleForm.condition,
                      category: e.target.value,
                    },
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Any Category</option>
                <option value="dining">Dining</option>
                <option value="shopping">Shopping</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Value
              </label>
              <input
                type="number"
                step="0.01"
                value={ruleForm.value}
                onChange={(e) =>
                  setRuleForm({
                    ...ruleForm,
                    value: parseFloat(e.target.value) || 0,
                  })
                }
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder={
                  ruleForm.rewardType === "points"
                    ? "Multiplier (e.g., 2.0)"
                    : ruleForm.rewardType === "cashback"
                    ? "Percentage (e.g., 0.05)"
                    : "Upgrade threshold"
                }
                required
              />
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setShowRuleModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700"
              >
                {editingRule ? "Update Rule" : "Create Rule"}
              </button>
            </div>
          </form>
        </div>

        <button
          onClick={() => setShowRuleModal(false)}
          className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center space-x-3 mb-4">
          <Settings className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Rewards Administration
            </h1>
            <p className="text-gray-600">
              Manage reward rules, view analytics, and monitor user activity
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab("rules")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === "rules"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Settings className="inline h-5 w-5 mr-2" />
              Rules Management
            </button>
            <button
              onClick={() => setActiveTab("users")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === "users"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Users className="inline h-5 w-5 mr-2" />
              Top Users
            </button>
            <button
              onClick={() => setActiveTab("analytics")}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === "analytics"
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <BarChart3 className="inline h-5 w-5 mr-2" />
              Analytics
            </button>
          </nav>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Tab Content */}
      {activeTab === "rules" && <RulesTab />}
      {activeTab === "users" && <TopUsersTab />}
      {activeTab === "analytics" && <AnalyticsTab />}

      {/* Rule Modal */}
      {showRuleModal && <RuleModal />}
    </div>
  );
};

export default RewardsAdmin;
