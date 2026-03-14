import React, { useState, useEffect } from "react";
import { Pie, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement,
} from "chart.js";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  PointElement,
  LineElement
);

const WealthDashboard = ({ darkMode }) => {
  const [activeTab, setActiveTab] = useState("portfolio");
  const [investments, setInvestments] = useState([]);
  const [goals, setGoals] = useState({
    active: [],
    completed: [],
    summary: {},
  });
  const [portfolio, setPortfolio] = useState({});
  const [loading, setLoading] = useState(true);

  // Fetch investments data
  const fetchInvestments = async () => {
    try {
      const response = await fetch("/api/investments/me", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setInvestments(data.data.investments);
        setPortfolio(data.data.portfolio);
      }
    } catch (error) {
      console.error("Failed to fetch investments:", error);
    }
  };

  // Fetch goals data
  const fetchGoals = async () => {
    try {
      const response = await fetch("/api/goals/me", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });
      const data = await response.json();
      if (data.success) {
        setGoals(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch goals:", error);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      await Promise.all([fetchInvestments(), fetchGoals()]);
      setLoading(false);
    };
    fetchData();
  }, []);

  // Asset allocation pie chart data
  const assetAllocationData = {
    labels: Object.keys(portfolio.byAssetType || {}),
    datasets: [
      {
        data: Object.values(portfolio.byAssetType || {}),
        backgroundColor: [
          "#22c55e",
          "#ef4444",
          "#3b82f6",
          "#eab308",
          "#a855f7",
          "#f97316",
        ],
        borderColor: [
          "#16a34a",
          "#b91c1c",
          "#1d4ed8",
          "#ca8a04",
          "#7c3aed",
          "#ea580c",
        ],
        borderWidth: 2,
      },
    ],
  };

  // Portfolio growth line chart data (simplified - would need historical data)
  const portfolioGrowthData = {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    datasets: [
      {
        label: "Portfolio Value",
        data: [10000, 10500, 10200, 10800, 11200, 11500],
        borderColor: "#22c55e",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        tension: 0.4,
        fill: true,
      },
    ],
  };

  const formatCurrency = (amount) =>
    `$${parseFloat(amount || 0).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div
      className={`p-6 rounded-lg shadow-lg ${
        darkMode ? "bg-gray-800 text-white" : "bg-white text-gray-900"
      }`}
    >
      <h2 className="text-2xl font-bold mb-6 text-center">
        💰 Wealth & Investments
      </h2>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setActiveTab("portfolio")}
          className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
            activeTab === "portfolio"
              ? "bg-blue-500 text-white shadow-md"
              : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          📊 Portfolio
        </button>
        <button
          onClick={() => setActiveTab("goals")}
          className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
            activeTab === "goals"
              ? "bg-blue-500 text-white shadow-md"
              : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          🎯 Goals
        </button>
        <button
          onClick={() => setActiveTab("performance")}
          className={`flex-1 py-2 px-4 rounded-md font-medium transition-all ${
            activeTab === "performance"
              ? "bg-blue-500 text-white shadow-md"
              : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          📈 Performance
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "portfolio" && (
        <div className="space-y-6">
          {/* Portfolio Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Total Invested
              </h3>
              <p className="text-2xl font-bold text-blue-500">
                {formatCurrency(portfolio.totalInvested)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Current Value
              </h3>
              <p className="text-2xl font-bold text-green-500">
                {formatCurrency(portfolio.totalCurrentValue)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">Gain/Loss</h3>
              <p
                className={`text-2xl font-bold ${
                  parseFloat(portfolio.totalGainLoss) >= 0
                    ? "text-green-500"
                    : "text-red-500"
                }`}
              >
                {formatCurrency(portfolio.totalGainLoss)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">% Change</h3>
              <p
                className={`text-2xl font-bold ${
                  parseFloat(portfolio.totalGainLossPercentage) >= 0
                    ? "text-green-500"
                    : "text-red-500"
                }`}
              >
                {portfolio.totalGainLossPercentage?.toFixed(2)}%
              </p>
            </div>
          </div>

          {/* Asset Allocation Chart */}
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <h3 className="text-xl font-semibold mb-4">Asset Allocation</h3>
            {Object.keys(portfolio.byAssetType || {}).length > 0 ? (
              <div className="max-w-md mx-auto">
                <Pie
                  data={assetAllocationData}
                  options={{ plugins: { legend: { position: "bottom" } } }}
                />
              </div>
            ) : (
              <p className="text-center text-gray-500">No investments yet</p>
            )}
          </div>

          {/* Investments List */}
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <h3 className="text-xl font-semibold mb-4">Your Investments</h3>
            <div className="space-y-2">
              {investments.length > 0 ? (
                investments.map((investment) => (
                  <div
                    key={investment._id}
                    className={`flex justify-between items-center p-4 rounded-lg ${
                      darkMode ? "bg-gray-600" : "bg-white"
                    } shadow`}
                  >
                    <div>
                      <h4 className="font-semibold">
                        {investment.name || investment.symbol}
                      </h4>
                      <p className="text-sm text-gray-500">
                        {investment.symbol} • {investment.assetType}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatCurrency(
                          investment.currentValue || investment.amountInvested
                        )}
                      </p>
                      <p
                        className={`text-sm ${
                          parseFloat(investment.gainLossPercentage || 0) >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {parseFloat(investment.gainLossPercentage || 0).toFixed(
                          2
                        )}
                        %
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500">No investments yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "goals" && (
        <div className="space-y-6">
          {/* Goals Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">
                Active Goals
              </h3>
              <p className="text-2xl font-bold text-blue-500">
                {goals.summary?.totalActive || 0}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">Total Saved</h3>
              <p className="text-2xl font-bold text-green-500">
                {formatCurrency(goals.summary?.totalSaved)}
              </p>
            </div>
            <div
              className={`p-4 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-sm font-medium text-gray-500">Progress</h3>
              <p className="text-2xl font-bold text-purple-500">
                {goals.summary?.completionRate?.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Active Goals */}
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <h3 className="text-xl font-semibold mb-4">Active Savings Goals</h3>
            <div className="space-y-4">
              {goals.active?.map((goal) => (
                <div
                  key={goal._id}
                  className={`p-4 rounded-lg ${
                    darkMode ? "bg-gray-600" : "bg-white"
                  } shadow`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold">{goal.goalName}</h4>
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        goal.priority === "high"
                          ? "bg-red-100 text-red-800"
                          : goal.priority === "medium"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {goal.priority}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-500 mb-2">
                    <span>
                      {formatCurrency(goal.currentSaved)} /{" "}
                      {formatCurrency(goal.targetAmount)}
                    </span>
                    <span>
                      {goal.completionPercentage?.toFixed(1)}% complete
                    </span>
                  </div>
                  <div className="w-full bg-gray-300 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-green-500 h-3 rounded-full transition-all duration-500"
                      style={{ width: `${goal.completionPercentage}%` }}
                    ></div>
                  </div>
                  {goal.deadline && (
                    <p className="text-sm text-gray-500 mt-2">
                      Due: {new Date(goal.deadline).toLocaleDateString()} •
                      {goal.daysUntilDeadline > 0
                        ? ` ${goal.daysUntilDeadline} days left`
                        : " Overdue"}
                    </p>
                  )}
                </div>
              )) || []}
              {goals.active?.length === 0 && (
                <p className="text-center text-gray-500">No active goals yet</p>
              )}
            </div>
          </div>

          {/* Completed Goals */}
          {goals.completed?.length > 0 && (
            <div
              className={`p-6 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-xl font-semibold mb-4">Completed Goals 🏆</h3>
              <div className="space-y-2">
                {goals.completed.map((goal) => (
                  <div
                    key={goal._id}
                    className="flex justify-between items-center p-3 bg-green-50 rounded"
                  >
                    <span>{goal.goalName}</span>
                    <span className="text-green-600 font-semibold">
                      {formatCurrency(goal.targetAmount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "performance" && (
        <div className="space-y-6">
          {/* Performance Chart */}
          <div
            className={`p-6 rounded-lg ${
              darkMode ? "bg-gray-700" : "bg-gray-50"
            }`}
          >
            <h3 className="text-xl font-semibold mb-4">Portfolio Growth</h3>
            <div className="max-w-4xl mx-auto">
              <Line
                data={portfolioGrowthData}
                options={{
                  responsive: true,
                  plugins: { legend: { position: "top" } },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: { callback: (value) => formatCurrency(value) },
                    },
                  },
                }}
              />
            </div>
          </div>

          {/* Top Performers */}
          {portfolio.topPerformers?.length > 0 && (
            <div
              className={`p-6 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-xl font-semibold mb-4">Top Performers 📈</h3>
              <div className="space-y-2">
                {portfolio.topPerformers.map((performer, index) => (
                  <div
                    key={index}
                    className="flex justify-between items-center p-3 bg-green-50 rounded"
                  >
                    <span>
                      {performer.name} ({performer.symbol})
                    </span>
                    <span className="text-green-600 font-semibold">
                      +{performer.gainLossPercentage}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Activity */}
          {portfolio.recentPurchases?.length > 0 && (
            <div
              className={`p-6 rounded-lg ${
                darkMode ? "bg-gray-700" : "bg-gray-50"
              }`}
            >
              <h3 className="text-xl font-semibold mb-4">Recent Purchases</h3>
              <div className="space-y-2">
                {portfolio.recentPurchases.map((purchase, index) => (
                  <div
                    key={index}
                    className="flex justify-between items-center p-3 bg-blue-50 rounded"
                  >
                    <span>
                      {purchase.name} ({purchase.symbol})
                    </span>
                    <span className="text-blue-600 font-semibold">
                      {formatCurrency(purchase.amountInvested)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WealthDashboard;
