import React, { useState, useEffect } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Pie, Line } from "react-chartjs-2";

ChartJS.register(
  ArcElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

export default function Analytics() {
  const [summary, setSummary] = useState(null);
  const [trends, setTrends] = useState([]);
  const [loading, setLoading] = useState(true);

  // Mock user ID - replace with actual user ID from auth
  const userId = "mock-user-id";

  useEffect(() => {
    fetchAnalyticsData();
  }, []);

  const fetchAnalyticsData = async () => {
    try {
      const [summaryResponse, trendsResponse] = await Promise.all([
        fetch(`/api/analytics/${userId}/summary`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }),
        fetch(`/api/analytics/${userId}/trends`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }),
      ]);

      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        setSummary(summaryData.data);
      }

      if (trendsResponse.ok) {
        const trendsData = await trendsResponse.json();
        setTrends(trendsData.data.trends);
      }
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-900 to-purple-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
          <p className="text-white">Loading Analytics...</p>
        </div>
      </div>
    );
  }

  // Pie chart data for category breakdown
  const categoryData = {
    labels: summary?.categoryBreakdown
      ? Object.keys(summary.categoryBreakdown)
      : [],
    datasets: [
      {
        data: summary?.categoryBreakdown
          ? Object.values(summary.categoryBreakdown)
          : [],
        backgroundColor: [
          "#22c55e", // green
          "#ef4444", // red
          "#3b82f6", // blue
          "#eab308", // yellow
          "#a855f7", // purple
          "#f97316", // orange
          "#06b6d4", // cyan
          "#84cc16", // lime
        ],
        borderWidth: 2,
        borderColor: "#ffffff",
      },
    ],
  };

  const categoryOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: "right",
        labels: {
          color: "#e5e7eb",
          font: {
            size: 12,
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed;
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${context.label}: ₹${value.toFixed(0)} (${percentage}%)`;
          },
        },
      },
    },
  };

  // Line chart data for trends
  const trendsData = {
    labels: trends.map((t) => t.month),
    datasets: [
      {
        label: "Income",
        data: trends.map((t) => t.income),
        borderColor: "#22c55e",
        backgroundColor: "rgba(34, 197, 94, 0.1)",
        tension: 0.4,
        fill: false,
      },
      {
        label: "Expenses",
        data: trends.map((t) => t.expenses),
        borderColor: "#ef4444",
        backgroundColor: "rgba(239, 68, 68, 0.1)",
        tension: 0.4,
        fill: false,
      },
      {
        label: "Savings",
        data: trends.map((t) => t.savings),
        borderColor: "#eab308",
        backgroundColor: "rgba(234, 179, 8, 0.1)",
        tension: 0.4,
        fill: true,
      },
    ],
  };

  const trendsOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: "top",
        labels: {
          color: "#e5e7eb",
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            return `${context.dataset.label}: ₹${context.parsed.y.toFixed(0)}`;
          },
        },
      },
    },
    scales: {
      y: {
        ticks: {
          callback: (value) => `₹${value}`,
          color: "#9ca3af",
        },
        grid: {
          color: "#374151",
        },
      },
      x: {
        ticks: {
          color: "#9ca3af",
        },
        grid: {
          color: "#374151",
        },
      },
    },
    elements: {
      point: {
        radius: 4,
        hoverRadius: 6,
      },
    },
  };

  return (
    <div className="min-h-screen py-8 px-4 bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent mb-4">
            📊 Analytics & Insights
          </h1>
          <p className="text-gray-300 text-lg">
            Understand your financial patterns and make smarter decisions
          </p>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-gradient-to-br from-green-600 to-green-800 rounded-xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-200 text-sm font-medium">
                  Total Income
                </p>
                <p className="text-2xl font-bold text-white">
                  ₹{summary?.totalIncome?.toFixed(0) || 0}
                </p>
              </div>
              <div className="text-4xl">💰</div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-red-600 to-red-800 rounded-xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-200 text-sm font-medium">
                  Total Expenses
                </p>
                <p className="text-2xl font-bold text-white">
                  ₹{summary?.totalExpenses?.toFixed(0) || 0}
                </p>
              </div>
              <div className="text-4xl">💸</div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-200 text-sm font-medium">Net Savings</p>
                <p className="text-2xl font-bold text-white">
                  ₹{summary?.netSavings?.toFixed(0) || 0}
                </p>
              </div>
              <div className="text-4xl">🎯</div>
            </div>
          </div>

          <div className="bg-gradient-to-br from-yellow-600 to-orange-600 rounded-xl p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-200 text-sm font-medium">
                  Monthly Prediction
                </p>
                <p className="text-2xl font-bold text-white">
                  ₹{summary?.savingsPrediction?.toFixed(0) || 0}
                </p>
              </div>
              <div className="text-4xl">🔮</div>
            </div>
          </div>
        </div>

        {/* Month over Month Comparison */}
        <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-6 mb-8 border border-white/10">
          <h2 className="text-xl font-semibold text-white mb-4">
            📈 Month-over-Month Comparison
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-gray-300 text-sm">This Month Savings</p>
              <p
                className={`text-2xl font-bold ${
                  summary?.monthComparison?.current >= 0
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                ₹{summary?.monthComparison?.current?.toFixed(0) || 0}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-300 text-sm">Last Month Savings</p>
              <p
                className={`text-2xl font-bold ${
                  summary?.monthComparison?.previous >= 0
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                ₹{summary?.monthComparison?.previous?.toFixed(0) || 0}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-300 text-sm">Change</p>
              <p
                className={`text-2xl font-bold ${
                  summary?.monthComparison?.percentageChange > 0
                    ? "text-green-400"
                    : summary?.monthComparison?.percentageChange < 0
                    ? "text-red-400"
                    : "text-gray-400"
                }`}
              >
                {summary?.monthComparison?.percentageChange > 0 ? "+" : ""}
                {summary?.monthComparison?.percentageChange?.toFixed(1) || 0}%
              </p>
            </div>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Category Breakdown Pie Chart */}
          <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-6 border border-white/10">
            <h2 className="text-xl font-semibold text-white mb-6">
              📊 Expense Categories
            </h2>
            {summary?.categoryBreakdown &&
            Object.keys(summary.categoryBreakdown).length > 0 ? (
              <Pie data={categoryData} options={categoryOptions} />
            ) : (
              <div className="text-center text-gray-400 py-12">
                <div className="text-4xl mb-4">📋</div>
                <p>No expense data available</p>
                <p className="text-sm">
                  Start adding transactions to see your category breakdown
                </p>
              </div>
            )}
          </div>

          {/* Trends Line Chart */}
          <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-6 border border-white/10">
            <h2 className="text-xl font-semibold text-white mb-6">
              📈 6-Month Trends
            </h2>
            {trends.length > 0 ? (
              <Line data={trendsData} options={trendsOptions} />
            ) : (
              <div className="text-center text-gray-400 py-12">
                <div className="text-4xl mb-4">📈</div>
                <p>No trend data available</p>
                <p className="text-sm">
                  More transaction history needed for trend analysis
                </p>
              </div>
            )}
          </div>
        </div>

        {/* AI Insights Section */}
        <div className="bg-gray-800/50 backdrop-blur-lg rounded-xl p-6 border border-white/10">
          <h2 className="text-xl font-semibold text-white mb-6">
            🎯 AI-Powered Insights
          </h2>
          {summary?.insights && summary.insights.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {summary.insights.map((insight, index) => (
                <div
                  key={index}
                  className="bg-gradient-to-r from-purple-600/20 to-blue-600/20 rounded-lg p-4 border border-purple-500/20"
                >
                  <div className="flex items-start space-x-3">
                    <div className="text-2xl">💡</div>
                    <div>
                      <p className="text-gray-200 text-sm leading-relaxed">
                        {insight}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">
              <div className="text-4xl mb-4">🤖</div>
              <p>AI insights will appear here as you use the platform</p>
              <p className="text-sm">
                Complete more transactions to unlock personalized financial
                insights
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
