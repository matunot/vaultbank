import React, { useState, useEffect, useCallback } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import { Line, Bar, Pie, Doughnut } from "react-chartjs-2";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const AnalyticsDashboard = ({ user }) => {
  const [activeTab, setActiveTab] = useState("personal");
  const [personalInsights, setPersonalInsights] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [systemInsights, setSystemInsights] = useState(null);
  const [loading, setLoading] = useState(false);

  const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";
  const userId = user?.id || user?._id;
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  // Fetch personal insights
  const fetchPersonalInsights = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_BASE_URL}/api/analytics/user/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        setPersonalInsights(data.data);
      }
    } catch (error) {
      console.error("Error fetching personal insights:", error);
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL, userId]);

  // Fetch predictions
  const fetchPredictions = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/predict`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        setPredictions(data.data);
      }
    } catch (error) {
      console.error("Error fetching predictions:", error);
    }
  }, [API_BASE_URL]);

  // Fetch system insights (admin only)
  const fetchSystemInsights = useCallback(async () => {
    if (!isAdmin) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/admin`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSystemInsights(data.data);
      }
    } catch (error) {
      console.error("Error fetching system insights:", error);
    }
  }, [API_BASE_URL, isAdmin]);

  // Initialize data
  useEffect(() => {
    fetchPersonalInsights();
    fetchPredictions();

    if (isAdmin) {
      fetchSystemInsights();
    }
  }, [fetchPersonalInsights, fetchPredictions, fetchSystemInsights, isAdmin]);

  // Get insight color based on priority
  const getInsightColor = (priority) => {
    switch (priority) {
      case "high":
        return "bg-red-100 border-red-300 text-red-800";
      case "medium":
        return "bg-yellow-100 border-yellow-300 text-yellow-800";
      default:
        return "bg-green-100 border-green-300 text-green-800";
    }
  };

  // Get risk color
  const getRiskColor = (score) => {
    if (score >= 70) return "text-red-600";
    if (score >= 35) return "text-yellow-600";
    return "text-green-600";
  };

  // Get heatmap color based on intensity (0-10)
  const getHeatmapColor = (intensity) => {
    if (intensity === 0) return "bg-gray-100";
    if (intensity <= 2) return "bg-green-100";
    if (intensity <= 4) return "bg-green-200";
    if (intensity <= 6) return "bg-green-300";
    if (intensity <= 8) return "bg-green-400";
    return "bg-green-500";
  };

  // Export to CSV
  const exportToCSV = (tabType) => {
    let data = [];
    let filename = `analytics-${tabType}-${
      new Date().toISOString().split("T")[0]
    }.csv`;

    if (tabType === "personal") {
      data = [
        ["Personal Insights", "", ""],
        ["Metric", "Value", "Description"],
        [
          "Total Transactions",
          personalInsights?.metrics?.totalTransactions || 0,
          "Number of transactions",
        ],
        [
          "Total Alerts",
          personalInsights?.metrics?.totalAlerts || 0,
          "Security alerts",
        ],
        [
          "Predicted Risk Score",
          personalInsights?.predictions?.nextRiskScore || 0,
          "Risk score prediction",
        ],
        [
          "Avg Daily Spending",
          personalInsights?.metrics?.averageDailySpending || 0,
          "Average daily spending",
        ],
        ["", "", ""],
        ["Spending Insights", "", ""],
        ...(personalInsights?.spendingInsights?.map((item) => [
          item.title,
          item.value,
          item.description,
        ]) || []),
        ["", "", ""],
        ["AI Insights", "", ""],
        ...(personalInsights?.insights?.map((insight) => [
          insight.message || insight,
          "",
          "",
        ]) || []),
      ];
    } else if (tabType === "predictive") {
      data = [
        ["Predictive Analytics", "", ""],
        ["Metric", "Value", "Description"],
        [
          "Current Risk Score",
          predictions?.riskPrediction?.currentScore || 0,
          "Current risk assessment",
        ],
        [
          "Predicted Risk Score",
          predictions?.riskPrediction?.predictedScore || 0,
          "Next month prediction",
        ],
        [
          "Risk Trend",
          predictions?.riskPrediction?.trend || "stable",
          "Risk score trend",
        ],
        [
          "Churn Likelihood",
          predictions?.churnPrediction?.likelihood || "low",
          "Customer retention prediction",
        ],
        [
          "Churn Probability",
          predictions?.churnPrediction?.probability || 0,
          "Churn probability percentage",
        ],
        [
          "Next Month Spending Estimate",
          predictions?.spendingPrediction?.nextMonthEstimate || 0,
          "Predicted monthly spending",
        ],
        [
          "Suspicious Activity Probability",
          predictions?.suspiciousActivityPrediction?.probability || 0,
          "Fraud detection probability",
        ],
      ];
    } else if (tabType === "system" && isAdmin) {
      data = [
        ["System Insights", "", ""],
        ["Metric", "Value", "Description"],
        [
          "Total Users",
          systemInsights?.userMetrics?.totalUsers || 0,
          "Active user count",
        ],
        [
          "High Risk Users",
          systemInsights?.riskMetrics?.flaggedUsers || 0,
          "Users flagged for high risk",
        ],
        [
          "Average Risk Score",
          systemInsights?.riskMetrics?.averageRiskScore || 0,
          "System-wide average risk",
        ],
        [
          "AML Cases",
          systemInsights?.amlMetrics?.totalCases || 0,
          "Anti-money laundering cases",
        ],
      ];
    }

    const csvContent = data
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export to PDF (basic implementation)
  const exportToPDF = (tabType) => {
    // For now, implement basic PDF export using browser print functionality
    // This can be enhanced with jsPDF library later
    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <html>
        <head>
          <title>VaultBank Analytics - ${tabType}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { background: linear-gradient(to right, #3b82f6, #8b5cf6); color: white; padding: 20px; border-radius: 10px; }
            .section { margin: 20px 0; padding: 15px; border: 1px solid #e5e7eb; border-radius: 5px; }
            .metric { display: flex; justify-content: space-between; margin: 10px 0; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>VaultBank Analytics & Insights Dashboard</h1>
            <p>Report Type: ${
              tabType.charAt(0).toUpperCase() + tabType.slice(1)
            } Insights</p>
            <p>Generated: ${new Date().toLocaleString()}</p>
          </div>
          <div class="section">
            <h2>${
              tabType.charAt(0).toUpperCase() + tabType.slice(1)
            } Analytics Report</h2>
            <p>This report contains ${tabType} analytics data from the VaultBank platform.</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="luxury-card p-6 bg-gradient-to-r from-blue-600 to-purple-700 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-2">
              📊 Analytics & Insights Dashboard
            </h2>
            <p className="text-blue-100">
              Understand your financial patterns, risk evolution, and predictive
              insights
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex space-x-2">
              <button
                onClick={() => exportToCSV(activeTab)}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2"
                disabled={loading}
              >
                <span>📄</span>
                <span>CSV</span>
              </button>
              <button
                onClick={() => exportToPDF(activeTab)}
                className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors flex items-center space-x-2"
                disabled={loading}
              >
                <span>📊</span>
                <span>PDF</span>
              </button>
            </div>
            <div className="px-3 py-1 bg-white/20 rounded-full text-sm">
              💡 AI-Powered Analytics
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="luxury-card">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {[
              { id: "personal", label: "👤 Personal Insights", icon: "👤" },
              {
                id: "predictive",
                label: "🔮 Predictive Analytics",
                icon: "🔮",
              },
              ...(isAdmin
                ? [{ id: "system", label: "🏢 System Insights", icon: "🏢" }]
                : []),
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {loading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-600">Loading analytics data...</p>
            </div>
          ) : (
            <>
              {/* Personal Insights Tab */}
              {activeTab === "personal" && personalInsights && (
                <div className="space-y-8">
                  <h3 className="text-2xl font-bold text-gray-800">
                    Personal Financial Insights
                  </h3>

                  {/* Financial Metrics Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="luxury-card p-6 text-center">
                      <div className="text-3xl mb-2">💰</div>
                      <div className="text-2xl font-bold text-green-600">
                        ${personalInsights?.metrics?.totalTransactions || 0}
                      </div>
                      <div className="text-sm text-gray-600">
                        Total Transactions
                      </div>
                    </div>

                    <div className="luxury-card p-6 text-center">
                      <div className="text-3xl mb-2">🚨</div>
                      <div className="text-2xl font-bold text-red-600">
                        {personalInsights?.metrics?.totalAlerts || 0}
                      </div>
                      <div className="text-sm text-gray-600">
                        Security Alerts
                      </div>
                    </div>

                    <div className="luxury-card p-6 text-center">
                      <div className="text-3xl mb-2">⚖️</div>
                      <div
                        className={`text-2xl font-bold ${getRiskColor(
                          personalInsights?.predictions?.nextRiskScore || 0
                        )}`}
                      >
                        {personalInsights?.predictions?.nextRiskScore || 0}
                      </div>
                      <div className="text-sm text-gray-600">
                        Predicted Risk Score
                      </div>
                    </div>

                    <div className="luxury-card p-6 text-center">
                      <div className="text-3xl mb-2">💸</div>
                      <div className="text-2xl font-bold text-blue-600">
                        $
                        {(
                          personalInsights?.metrics?.averageDailySpending || 0
                        ).toFixed(0)}
                      </div>
                      <div className="text-sm text-gray-600">
                        Avg Daily Spending
                      </div>
                    </div>
                  </div>

                  {/* Charts Section */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Spending Insights Chart */}
                    <div className="luxury-card p-6">
                      <h4 className="text-xl font-bold mb-4">
                        Spending Patterns
                      </h4>
                      {personalInsights?.spendingInsights?.length > 0 ? (
                        <Bar
                          data={{
                            labels: personalInsights.spendingInsights.map(
                              (item) => item.title
                            ),
                            datasets: [
                              {
                                label: "Amount",
                                data: personalInsights.spendingInsights.map(
                                  (item) => item.value || 0
                                ),
                                backgroundColor: [
                                  "#22c55e",
                                  "#ef4444",
                                  "#3b82f6",
                                  "#eab308",
                                ],
                              },
                            ],
                          }}
                          options={{
                            responsive: true,
                            plugins: {
                              legend: { display: false },
                            },
                          }}
                        />
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <div className="text-4xl mb-2">📊</div>
                          <p>No spending data available</p>
                        </div>
                      )}
                    </div>

                    {/* Alert Types Pie Chart */}
                    <div className="luxury-card p-6">
                      <h4 className="text-xl font-bold mb-4">
                        Alert Distribution
                      </h4>
                      {personalInsights?.alertHistory?.length > 0 ? (
                        <Pie
                          data={{
                            labels: ["Security", "Budget", "System"],
                            datasets: [
                              {
                                data: [
                                  personalInsights.alertHistory.filter(
                                    (a) => a.category === "security"
                                  ).length,
                                  personalInsights.alertHistory.filter(
                                    (a) => a.category === "budget"
                                  ).length,
                                  personalInsights.alertHistory.filter(
                                    (a) => a.category === "system"
                                  ).length,
                                ],
                                backgroundColor: [
                                  "#ef4444",
                                  "#eab308",
                                  "#3b82f6",
                                ],
                              },
                            ],
                          }}
                          options={{
                            responsive: true,
                            plugins: {
                              legend: { position: "bottom" },
                            },
                          }}
                        />
                      ) : (
                        <div className="text-center py-8 text-gray-500">
                          <div className="text-4xl mb-2">🔔</div>
                          <p>No alerts recorded</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Login Activity Heatmap */}
                  <div className="luxury-card p-6">
                    <h4 className="text-xl font-bold mb-4 flex items-center">
                      <span className="text-2xl mr-2">🕐</span>
                      Login Activity Heatmap
                    </h4>
                    {personalInsights?.behavioralPatterns?.loginPatterns ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-8 gap-1 text-xs">
                          {/* Header row with hours */}
                          <div></div>
                          {Array.from({ length: 24 }, (_, i) => (
                            <div
                              key={i}
                              className="text-center font-semibold text-gray-600"
                            >
                              {i.toString().padStart(2, "0")}
                            </div>
                          ))}

                          {/* Data rows for each day */}
                          {personalInsights.behavioralPatterns.loginPatterns.byDay?.map(
                            (day, dayIndex) => (
                              <React.Fragment key={dayIndex}>
                                <div className="font-semibold text-gray-600 text-right pr-2">
                                  {day.day.substring(0, 3)}
                                </div>
                                {Array.from({ length: 24 }, (_, hour) => {
                                  // Generate some sample data if real data is not available
                                  const activity =
                                    personalInsights.behavioralPatterns
                                      .loginPatterns.byHour?.[hour] ||
                                    Math.floor(Math.random() * 10);
                                  const intensity = Math.min(activity / 2, 10); // Scale to 0-10 for color intensity

                                  return (
                                    <div
                                      key={hour}
                                      className={`aspect-square rounded-sm flex items-center justify-center text-white text-xs font-bold ${getHeatmapColor(
                                        intensity
                                      )}`}
                                      title={`${day.day} ${hour}:00 - ${activity} logins`}
                                    >
                                      {activity > 0 ? activity : ""}
                                    </div>
                                  );
                                })}
                              </React.Fragment>
                            )
                          ) || []}
                        </div>

                        <div className="flex justify-between items-center text-sm text-gray-600">
                          <span>Less Active</span>
                          <div className="flex space-x-1">
                            {Array.from({ length: 5 }, (_, i) => (
                              <div
                                key={i}
                                className={`w-4 h-4 rounded-sm ${getHeatmapColor(
                                  i * 2
                                )}`}
                              />
                            ))}
                          </div>
                          <span>More Active</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <div className="text-4xl mb-2">🕐</div>
                        <p>
                          Login activity data will appear as you use the
                          platform
                        </p>
                      </div>
                    )}
                  </div>

                  {/* AI-Powered Insights */}
                  <div className="luxury-card p-6">
                    <h4 className="text-xl font-bold mb-4 flex items-center">
                      <span className="text-2xl mr-2">🤖</span>
                      AI-Generated Insights
                    </h4>
                    {personalInsights?.insights?.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {personalInsights.insights.map((insight, index) => (
                          <div
                            key={index}
                            className={`p-4 rounded-lg border ${getInsightColor(
                              "low"
                            )}`}
                          >
                            <div className="flex items-start space-x-3">
                              <div className="text-lg">💡</div>
                              <p className="text-sm">
                                {insight.message || insight}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <div className="text-4xl mb-2">🤖</div>
                        <p>
                          AI insights will appear as you use the platform more
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Predictive Analytics Tab */}
              {activeTab === "predictive" && predictions && (
                <div className="space-y-8">
                  <h3 className="text-2xl font-bold text-gray-800">
                    Predictive Analytics
                  </h3>

                  {/* Risk Prediction */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="luxury-card p-6 text-center">
                      <h4 className="font-bold mb-2">Current Risk Score</h4>
                      <div
                        className={`text-3xl font-bold mb-2 ${getRiskColor(
                          predictions.riskPrediction?.currentScore || 0
                        )}`}
                      >
                        {predictions.riskPrediction?.currentScore || 0}
                      </div>
                      <div className="text-sm text-gray-600">Out of 100</div>
                    </div>

                    <div className="luxury-card p-6 text-center">
                      <h4 className="font-bold mb-2">Next Month Prediction</h4>
                      <div
                        className={`text-3xl font-bold mb-2 ${getRiskColor(
                          predictions.riskPrediction?.predictedScore || 0
                        )}`}
                      >
                        {predictions.riskPrediction?.predictedScore || 0}
                      </div>
                      <div className="text-sm text-gray-600">
                        {predictions.riskPrediction?.trend === "increasing"
                          ? "↗️ Rising"
                          : "↘️ Decreasing"}
                      </div>
                    </div>

                    <div className="luxury-card p-6 text-center">
                      <h4 className="font-bold mb-2">Churn Likelihood</h4>
                      <div
                        className={`text-3xl font-bold mb-2 ${
                          predictions.churnPrediction?.likelihood === "high"
                            ? "text-red-600"
                            : predictions.churnPrediction?.likelihood ===
                              "medium"
                            ? "text-yellow-600"
                            : "text-green-600"
                        }`}
                      >
                        {predictions.churnPrediction?.likelihood?.toUpperCase() ||
                          "LOW"}
                      </div>
                      <div className="text-sm text-gray-600">
                        {predictions.churnPrediction?.probability || 0}%
                      </div>
                    </div>
                  </div>

                  {/* Risk Score Prediction Chart */}
                  <div className="luxury-card p-6">
                    <h4 className="text-xl font-bold mb-4">
                      Risk Score Evolution
                    </h4>
                    <Line
                      data={{
                        labels: ["Current", "Predicted (Next Month)"],
                        datasets: [
                          {
                            label: "Risk Score",
                            data: [
                              predictions.riskPrediction?.currentScore || 0,
                              predictions.riskPrediction?.predictedScore || 0,
                            ],
                            borderColor: "#ef4444",
                            backgroundColor: "rgba(239, 68, 68, 0.1)",
                            tension: 0.4,
                          },
                        ],
                      }}
                      options={{
                        responsive: true,
                        plugins: {
                          legend: { display: false },
                        },
                        scales: {
                          y: { beginAtZero: true, max: 100 },
                        },
                      }}
                    />
                  </div>

                  {/* Factors Affecting Predictions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="luxury-card p-6">
                      <h4 className="text-lg font-bold mb-3">
                        🚨 Suspicious Activity Analysis
                      </h4>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm">
                            Suspicious Activity Probability
                          </span>
                          <span
                            className={`font-bold ${
                              predictions.suspiciousActivityPrediction
                                ?.probability > 50
                                ? "text-red-600"
                                : "text-green-600"
                            }`}
                          >
                            {predictions.suspiciousActivityPrediction
                              ?.probability || 0}
                            %
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-red-600 h-2 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(
                                predictions.suspiciousActivityPrediction
                                  ?.probability || 0,
                                100
                              )}%`,
                            }}
                          ></div>
                        </div>
                        <ul className="text-xs text-gray-600 mt-2 space-y-1">
                          {predictions.suspiciousActivityPrediction?.indicators?.map(
                            (indicator, index) => (
                              <li key={index}>• {indicator}</li>
                            )
                          )}
                        </ul>
                      </div>
                    </div>

                    <div className="luxury-card p-6">
                      <h4 className="text-lg font-bold mb-3">
                        📊 Spending Prediction
                      </h4>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm">Next Month Estimate</span>
                          <span className="font-bold text-blue-600">
                            $
                            {predictions.spendingPrediction?.nextMonthEstimate?.toFixed(
                              0
                            ) || 0}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600">
                          Trend:{" "}
                          <span
                            className={`font-semibold ${
                              predictions.spendingPrediction?.trend ===
                              "increasing"
                                ? "text-red-600"
                                : "text-green-600"
                            }`}
                          >
                            {predictions.spendingPrediction?.trend || "stable"}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600">
                          Prediction Confidence:{" "}
                          {predictions.spendingPrediction?.confidence || 0}%
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* System Insights Tab (Admin Only) */}
              {activeTab === "system" && isAdmin && systemInsights && (
                <div className="space-y-8">
                  <h3 className="text-2xl font-bold text-gray-800">
                    System-Wide Analytics
                  </h3>

                  {/* System Metrics Overview */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div className="luxury-card p-6 text-center">
                      <div className="text-3xl mb-2">👥</div>
                      <div className="text-2xl font-bold text-blue-600">
                        {systemInsights.userMetrics?.totalUsers || 0}
                      </div>
                      <div className="text-sm text-gray-600">Total Users</div>
                    </div>

                    <div className="luxury-card p-6 text-center">
                      <div className="text-3xl mb-2">🚨</div>
                      <div className="text-2xl font-bold text-red-600">
                        {systemInsights.riskMetrics?.flaggedUsers || 0}
                      </div>
                      <div className="text-sm text-gray-600">
                        High Risk Users
                      </div>
                    </div>

                    <div className="luxury-card p-6 text-center">
                      <div className="text-3xl mb-2">⚖️</div>
                      <div className="text-2xl font-bold text-orange-600">
                        {systemInsights.riskMetrics?.averageRiskScore || 0}
                      </div>
                      <div className="text-sm text-gray-600">
                        Average Risk Score
                      </div>
                    </div>

                    <div className="luxury-card p-6 text-center">
                      <div className="text-3xl mb-2">📦</div>
                      <div className="text-2xl font-bold text-purple-600">
                        {systemInsights.amlMetrics?.totalCases || 0}
                      </div>
                      <div className="text-sm text-gray-600">AML Cases</div>
                    </div>
                  </div>

                  {/* System Insights Chart */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="luxury-card p-6">
                      <h4 className="text-xl font-bold mb-4">
                        Risk Distribution
                      </h4>
                      <Doughnut
                        data={{
                          labels: [
                            "Low Risk",
                            "Medium Risk",
                            "High Risk",
                            "Critical",
                          ],
                          datasets: [
                            {
                              data: [
                                systemInsights.riskMetrics?.riskDistribution
                                  ?.low || 0,
                                systemInsights.riskMetrics?.riskDistribution
                                  ?.medium || 0,
                                systemInsights.riskMetrics?.riskDistribution
                                  ?.high || 0,
                                systemInsights.riskMetrics?.riskDistribution
                                  ?.critical || 0,
                              ],
                              backgroundColor: [
                                "#22c55e",
                                "#eab308",
                                "#f97316",
                                "#ef4444",
                              ],
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          plugins: {
                            legend: { position: "bottom" },
                          },
                        }}
                      />
                    </div>

                    <div className="luxury-card p-6">
                      <h4 className="text-xl font-bold mb-4">
                        System Trends (Last 30 Days)
                      </h4>
                      <Bar
                        data={{
                          labels: [
                            "User Growth",
                            "Risk Increase",
                            "Alert Volume",
                            "AML Case Reduction",
                          ],
                          datasets: [
                            {
                              label: "Percentage Change",
                              data: [
                                parseFloat(
                                  systemInsights.trends?.userGrowth || "0"
                                ),
                                parseFloat(
                                  systemInsights.trends?.riskIncrease || "0"
                                ),
                                parseFloat(
                                  systemInsights.trends?.alertVolume || "0"
                                ),
                                parseFloat(
                                  systemInsights.trends?.amlCaseReduction || "0"
                                ),
                              ],
                              backgroundColor: [
                                "#22c55e",
                                "#ef4444",
                                "#eab308",
                                "#3b82f6",
                              ],
                            },
                          ],
                        }}
                        options={{
                          responsive: true,
                          plugins: {
                            legend: { display: false },
                          },
                          scales: {
                            y: {
                              beginAtZero: true,
                              ticks: {
                                callback: (value) => value + "%",
                              },
                            },
                          },
                        }}
                      />
                    </div>
                  </div>

                  {/* Admin Insights */}
                  {systemInsights.insights &&
                    systemInsights.insights.length > 0 && (
                      <div className="luxury-card p-6">
                        <h4 className="text-xl font-bold mb-4 flex items-center">
                          <span className="text-2xl mr-2">⚠️</span>
                          System Alerts & Recommendations
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {systemInsights.insights.map((insight, index) => (
                            <div
                              key={index}
                              className={`p-4 rounded-lg border ${getInsightColor(
                                insight.priority
                              )}`}
                            >
                              <div className="flex items-start space-x-3">
                                <div className="text-lg">
                                  {insight.type === "risk"
                                    ? "⚠️"
                                    : insight.type === "success"
                                    ? "✅"
                                    : "ℹ️"}
                                </div>
                                <div>
                                  <h5 className="font-semibold">
                                    {insight.title}
                                  </h5>
                                  <p className="text-sm mt-1">
                                    {insight.message}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
