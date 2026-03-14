import React, { useState, useEffect, useCallback } from "react";
import { useSuccessToast, useErrorToast } from "./NotificationContainer";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
} from "chart.js";
import { Pie, Line } from "react-chartjs-2";

// Register Chart.js components
ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement
);

const AdminCommandCenter = ({ user }) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);

  // Data states
  const [overviewData, setOverviewData] = useState(null);
  const [alertsData, setAlertsData] = useState([]);
  const [riskData, setRiskData] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [adminLogs, setAdminLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [amlCases, setAmlCases] = useState([]);
  const [amlCasesLoading, setAmlCasesLoading] = useState(false);
  const [amlStats, setAmlStats] = useState(null);

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  const errorToast = useErrorToast();
  const successToast = useSuccessToast();

  // Check if user is admin
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  // API helper functions
  const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

  const fetchOverviewData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/admin/overview`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (result.success) {
        setOverviewData(result.data);
      } else {
        errorToast(result.message || "Failed to load overview data");
      }
    } catch (error) {
      console.error("Overview fetch error:", error);
      errorToast("Failed to load overview data");
    } finally {
      setLoading(false);
    }
  }, [API_BASE_URL, errorToast]);

  // Authentication check - hooks must be called unconditionally
  useEffect(() => {
    if (isAdmin) {
      fetchOverviewData();
    } else {
      errorToast("Access denied. Admin privileges required.");
    }
  }, [isAdmin, errorToast, fetchOverviewData]);

  const fetchAlertsData = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/alerts`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (result.success) {
        setAlertsData(result.data);
      } else {
        errorToast(result.message || "Failed to load alerts data");
      }
    } catch (error) {
      console.error("Alerts fetch error:", error);
      errorToast("Failed to load alerts data");
    }
  }, [errorToast, API_BASE_URL]);

  const fetchRiskData = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/risk`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (result.success) {
        setRiskData(result.data);
      } else {
        errorToast(result.message || "Failed to load risk data");
      }
    } catch (error) {
      console.error("Risk fetch error:", error);
      errorToast("Failed to load risk data");
    }
  }, [errorToast, API_BASE_URL]);

  const fetchAdminLogs = useCallback(async () => {
    try {
      setLogsLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/admin/logs`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (result.success) {
        setAdminLogs(result.data);
      } else {
        errorToast(result.message || "Failed to load admin logs");
      }
    } catch (error) {
      console.error("Admin logs fetch error:", error);
      errorToast("Failed to load admin logs");
    } finally {
      setLogsLoading(false);
    }
  }, [errorToast, API_BASE_URL]);

  const fetchAmlCases = useCallback(async () => {
    try {
      setAmlCasesLoading(true);
      const response = await fetch(`${API_BASE_URL}/api/aml/cases`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (result.success) {
        setAmlCases(result.data.data);
      } else {
        errorToast(result.message || "Failed to load AML cases");
      }
    } catch (error) {
      console.error("AML cases fetch error:", error);
      errorToast("Failed to load AML cases");
    } finally {
      setAmlCasesLoading(false);
    }
  }, [errorToast, API_BASE_URL]);

  const fetchAmlStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/aml/stats`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();
      if (result.success) {
        setAmlStats(result.data);
      } else {
        errorToast(result.message || "Failed to load AML stats");
      }
    } catch (error) {
      console.error("AML stats fetch error:", error);
      errorToast("Failed to load AML stats");
    }
  }, [errorToast, API_BASE_URL]);

  const handleTabChange = async (tab) => {
    setActiveTab(tab);

    switch (tab) {
      case "alerts":
        await fetchAlertsData();
        break;
      case "risk":
        await fetchRiskData();
        break;
      case "aml":
        await fetchAmlCases();
        await fetchAmlStats();
        break;
      case "logs":
        await fetchAdminLogs();
        break;
      default:
        break;
    }
  };

  const handleAdminAction = (actionType, userId, additionalData = {}) => {
    setConfirmAction({
      type: actionType,
      userId,
      ...additionalData,
    });
  };

  const handleActionConfirm = async () => {
    if (!confirmAction) return;

    const { type, userId, reason } = confirmAction;
    setActionLoading(true);

    try {
      let endpoint,
        method = "POST",
        body = {};

      switch (type) {
        case "block":
          endpoint = `${API_BASE_URL}/api/admin/actions/block-user`;
          body = { userId, reason };
          break;
        case "unblock":
          endpoint = `${API_BASE_URL}/api/admin/actions/unblock-user`;
          body = { userId };
          break;
        case "revoke_sessions":
          endpoint = `${API_BASE_URL}/api/admin/actions/revoke-sessions`;
          body = { userId, reason };
          break;
        default:
          return;
      }

      const response = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (result.success) {
        successToast(result.message);
        setConfirmAction(null);
      } else {
        errorToast(result.message || "Action failed");
      }
    } catch (error) {
      console.error("Action error:", error);
      errorToast("Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  const searchUsers = useCallback(
    async (query) => {
      if (!query.trim()) {
        setUserSearchResults([]);
        return;
      }

      try {
        setUserSearchLoading(true);
        // For this example, we'll just simulate a search
        // In a real implementation, you'd have a specific endpoint for user search
        const response = await fetch(
          `${API_BASE_URL}/api/admin/users/search?q=${encodeURIComponent(
            query
          )}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
              "Content-Type": "application/json",
            },
          }
        );

        const result = await response.json();
        if (result.success) {
          setUserSearchResults(result.data);
        } else {
          errorToast("User search failed");
        }
      } catch (error) {
        console.error("User search error:", error);
        errorToast("User search failed");
      } finally {
        setUserSearchLoading(false);
      }
    },
    [errorToast, API_BASE_URL]
  );

  const handleAmlCaseAction = async (caseId, action, notes = "") => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/aml/cases/${caseId}/review`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action, notes }),
        }
      );

      const result = await response.json();
      if (result.success) {
        successToast(`AML case ${action} successfully`);
        await fetchAmlCases(); // Refresh cases
      } else {
        errorToast(result.message || "AML case action failed");
      }
    } catch (error) {
      console.error("AML case action error:", error);
      errorToast("AML case action failed");
    }
  };

  // Show loading while checking admin status
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="luxury-card p-8 text-center">
          <div className="text-6xl mb-4">🚫</div>
          <h1 className="text-2xl font-bold text-red-600 mb-2">
            Access Denied
          </h1>
          <p className="text-gray-600">
            You do not have permission to access the Admin Command Center.
          </p>
        </div>
      </div>
    );
  }

  // Sub-components
  const OverviewTab = () => {
    if (loading || !overviewData) {
      return <div className="text-center py-8">Loading overview...</div>;
    }

    const {
      totalUsers,
      activeSessions,
      flaggedAccounts,
      highRiskTransactions,
      riskDistribution,
    } = overviewData;

    const riskChartData = {
      labels: ["High Risk", "Medium Risk", "Low Risk"],
      datasets: [
        {
          data: [
            riskDistribution.highRisk,
            riskDistribution.mediumRisk,
            riskDistribution.lowRisk,
          ],
          backgroundColor: ["#DC2626", "#D97706", "#10B981"],
          borderWidth: 1,
        },
      ],
    };

    return (
      <div className="space-y-6">
        {/* Metrics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">👥</div>
            <div className="text-3xl font-bold text-blue-600">
              {totalUsers?.toLocaleString() || 0}
            </div>
            <div className="text-sm text-gray-600">Total Users</div>
          </div>

          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">🖥️</div>
            <div className="text-3xl font-bold text-green-600">
              {activeSessions?.toLocaleString() || 0}
            </div>
            <div className="text-sm text-gray-600">Active Sessions</div>
          </div>

          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">⚠️</div>
            <div className="text-3xl font-bold text-orange-600">
              {flaggedAccounts?.toLocaleString() || 0}
            </div>
            <div className="text-sm text-gray-600">Flagged Accounts</div>
          </div>

          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">🚨</div>
            <div className="text-3xl font-bold text-red-600">
              {highRiskTransactions?.toLocaleString() || 0}
            </div>
            <div className="text-sm text-gray-600">High Risk Transactions</div>
          </div>
        </div>

        {/* Risk Distribution Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="luxury-card p-6">
            <h3 className="text-xl font-bold mb-4">Risk Distribution</h3>
            <div className="h-64">
              <Pie
                data={riskChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { position: "bottom" },
                  },
                }}
              />
            </div>
          </div>

          <div className="luxury-card p-6">
            <h3 className="text-xl font-bold mb-4">Recent Critical Alerts</h3>
            <div className="space-y-3">
              {overviewData.recentAlerts?.slice(0, 5).map((alert, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded"
                >
                  <div className="flex items-start space-x-3">
                    <span className="text-lg">🚨</span>
                    <div>
                      <div className="font-semibold">{alert.title}</div>
                      <div className="text-sm text-gray-600">
                        {new Date(alert.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs rounded ${
                      alert.severity === "critical"
                        ? "bg-red-100 text-red-800"
                        : "bg-orange-100 text-orange-800"
                    }`}
                  >
                    {alert.severity}
                  </span>
                </div>
              )) || <div className="text-gray-500">No recent alerts</div>}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const AlertsTab = () => (
    <div className="space-y-4">
      <h3 className="text-xl font-bold">Critical System Alerts</h3>
      <div className="space-y-3">
        {alertsData.length > 0 ? (
          alertsData.map((alert) => (
            <div
              key={alert.id}
              className={`luxury-card p-4 border-l-4 ${
                alert.severity === "critical"
                  ? "border-red-500"
                  : "border-orange-500"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-start space-x-3">
                  <span className="text-lg">
                    {alert.severity === "critical" ? "🚨" : "⚠️"}
                  </span>
                  <div>
                    <h4 className="font-semibold">{alert.title}</h4>
                    <p className="text-sm text-gray-600">{alert.message}</p>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(alert.timestamp).toLocaleString()}
                      {alert.userEmail !== "System" &&
                        ` • User: ${alert.userEmail}`}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`px-2 py-1 text-xs rounded mb-2 ${
                      alert.severity === "critical"
                        ? "bg-red-100 text-red-800"
                        : "bg-orange-100 text-orange-800"
                    }`}
                  >
                    {alert.severity}
                  </div>
                  <button className="text-xs text-blue-600 hover:underline">
                    {alert.resolved ? "Resolved" : "Mark as Resolved"}
                  </button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">✅</div>
            <p>No critical alerts at this time</p>
          </div>
        )}
      </div>
    </div>
  );

  const RiskTab = () => (
    <div className="space-y-6">
      {riskData ? (
        <>
          {/* Risk Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="luxury-card p-6 text-center">
              <div className="text-4xl mb-2">🔴</div>
              <div className="text-2xl font-bold text-red-600">
                {riskData.currentDistribution?.high || 0}
              </div>
              <div className="text-sm text-gray-600">High Risk Users</div>
            </div>
            <div className="luxury-card p-6 text-center">
              <div className="text-4xl mb-2">🟡</div>
              <div className="text-2xl font-bold text-yellow-600">
                {riskData.currentDistribution?.medium || 0}
              </div>
              <div className="text-sm text-gray-600">Medium Risk Users</div>
            </div>
            <div className="luxury-card p-6 text-center">
              <div className="text-4xl mb-2">🟢</div>
              <div className="text-2xl font-bold text-green-600">
                {riskData.currentDistribution?.low || 0}
              </div>
              <div className="text-sm text-gray-600">Low Risk Users</div>
            </div>
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="luxury-card p-6">
              <h3 className="text-xl font-bold mb-4">Risk Distribution</h3>
              <div className="h-64">
                <Pie
                  data={{
                    labels: ["High Risk", "Medium Risk", "Low Risk"],
                    datasets: [
                      {
                        data: [
                          riskData.currentDistribution?.high || 0,
                          riskData.currentDistribution?.medium || 0,
                          riskData.currentDistribution?.low || 0,
                        ],
                        backgroundColor: ["#DC2626", "#D97706", "#10B981"],
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                  }}
                />
              </div>
            </div>

            <div className="luxury-card p-6">
              <h3 className="text-xl font-bold mb-4">Risk Trends (7 days)</h3>
              <div className="h-64">
                <Line
                  data={{
                    labels: riskData.trends?.map((t) => t.date) || [],
                    datasets: [
                      {
                        label: "High Risk",
                        data: riskData.trends?.map((t) => t.high) || [],
                        borderColor: "#DC2626",
                        backgroundColor: "rgba(220, 38, 38, 0.1)",
                        tension: 0.1,
                      },
                      {
                        label: "Medium Risk",
                        data: riskData.trends?.map((t) => t.medium) || [],
                        borderColor: "#D97706",
                        backgroundColor: "rgba(217, 119, 6, 0.1)",
                        tension: 0.1,
                      },
                      {
                        label: "Low Risk",
                        data: riskData.trends?.map((t) => t.low) || [],
                        borderColor: "#10B981",
                        backgroundColor: "rgba(16, 185, 129, 0.1)",
                        tension: 0.1,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: "bottom" },
                    },
                    scales: {
                      y: { beginAtZero: true },
                    },
                  }}
                />
              </div>
            </div>
          </div>

          {/* Top Risky Users */}
          <div className="luxury-card p-6">
            <h3 className="text-xl font-bold mb-4">Top Risky Users</h3>
            <div className="space-y-3">
              {riskData.topRiskUsers?.length > 0 ? (
                riskData.topRiskUsers.map((user, index) => (
                  <div
                    key={user.userId}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded"
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                          user.riskScore >= 70
                            ? "bg-red-500"
                            : user.riskScore >= 35
                            ? "bg-yellow-500"
                            : "bg-green-500"
                        }`}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <div className="font-semibold">
                          {user.name || user.email}
                        </div>
                        <div className="text-sm text-gray-600">
                          {user.email}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-bold px-2 py-1 rounded text-sm ${
                          user.riskScore >= 70
                            ? "bg-red-100 text-red-800"
                            : user.riskScore >= 35
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {Math.round(user.riskScore)} risk score
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Last evaluated:{" "}
                        {new Date(user.lastEvaluated).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-gray-500">
                  No risk data available
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-8">Loading risk analytics...</div>
      )}
    </div>
  );

  const AMLTab = () => (
    <div className="space-y-6">
      {/* AML Statistics */}
      {amlStats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">📋</div>
            <div className="text-2xl font-bold text-red-600">
              {amlStats.totalCases || 0}
            </div>
            <div className="text-sm text-gray-600">Total AML Cases</div>
          </div>
          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">🚫</div>
            <div className="text-2xl font-bold text-orange-600">
              {amlStats.blockedTransactions || 0}
            </div>
            <div className="text-sm text-gray-600">Blocked Transactions</div>
          </div>
          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">📊</div>
            <div className="text-2xl font-bold text-blue-600">
              {Math.round(amlStats.averageScore || 0)}
            </div>
            <div className="text-sm text-gray-600">Average Risk Score</div>
          </div>
        </div>
      )}

      {/* AML Cases Table */}
      <div className="luxury-card p-6">
        <h3 className="text-xl font-bold mb-4">AML Cases</h3>
        {amlCasesLoading ? (
          <div className="text-center py-8">Loading AML cases...</div>
        ) : amlCases.length > 0 ? (
          <div className="space-y-3">
            {amlCases.map((case_) => (
              <div
                key={case_.id}
                className={`p-4 border rounded-lg ${
                  case_.status === "open"
                    ? "border-yellow-200 bg-yellow-50"
                    : case_.status === "review"
                    ? "border-blue-200 bg-blue-50"
                    : case_.status === "approved"
                    ? "border-green-200 bg-green-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        case_.riskLevel === "critical"
                          ? "bg-red-500"
                          : case_.riskLevel === "high"
                          ? "bg-orange-500"
                          : case_.riskLevel === "medium"
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                    ></div>
                    <span className="font-semibold text-sm">
                      {case_.caseNumber}
                    </span>
                    <span className="text-sm text-gray-600">
                      {case_.user.email}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        case_.status === "open"
                          ? "bg-yellow-100 text-yellow-800"
                          : case_.status === "review"
                          ? "bg-blue-100 text-blue-800"
                          : case_.status === "approved"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }`}
                    >
                      {case_.status}
                    </span>
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        case_.riskLevel === "critical"
                          ? "bg-red-100 text-red-800"
                          : case_.riskLevel === "high"
                          ? "bg-orange-100 text-orange-800"
                          : case_.riskLevel === "medium"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {case_.riskLevel} risk
                    </span>
                  </div>
                </div>

                {case_.transaction && (
                  <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                    <span>Transaction: ${case_.transaction.amount}</span>
                    <span>{case_.transaction.beneficiary}</span>
                    <span>{case_.priority} priority</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500">
                    Created: {new Date(case_.createdAt).toLocaleString()}
                    {case_.dueDate && (
                      <>
                        {" • "}Due: {new Date(case_.dueDate).toLocaleString()}
                        {case_.isOverdue && (
                          <span className="text-red-600 font-semibold ml-1">
                            (OVERDUE)
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex space-x-2">
                    {case_.status === "open" && (
                      <button
                        onClick={() => handleAmlCaseAction(case_.id, "review")}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                      >
                        Review
                      </button>
                    )}
                    {case_.status === "review" && (
                      <>
                        <button
                          onClick={() =>
                            handleAmlCaseAction(case_.id, "approved")
                          }
                          className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() =>
                            handleAmlCaseAction(case_.id, "escalated")
                          }
                          className="px-3 py-1 bg-orange-600 text-white rounded text-xs hover:bg-orange-700"
                        >
                          Escalate
                        </button>
                        <button
                          onClick={() =>
                            handleAmlCaseAction(case_.id, "rejected")
                          }
                          className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <div className="text-4xl mb-2">📋</div>
            <p>No AML cases at this time</p>
          </div>
        )}
      </div>
    </div>
  );

  const UsersTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Search */}
        <div className="luxury-card p-6">
          <h3 className="text-xl font-bold mb-4">Search Users</h3>
          <input
            type="text"
            placeholder="Enter email or user ID..."
            value={userSearchQuery}
            onChange={(e) => setUserSearchQuery(e.target.value)}
            onKeyPress={(e) =>
              e.key === "Enter" && searchUsers(userSearchQuery)
            }
            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button
            onClick={() => searchUsers(userSearchQuery)}
            disabled={userSearchLoading}
            className="w-full mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {userSearchLoading ? "Searching..." : "🔍 Search"}
          </button>
        </div>

        {/* Selected User Actions */}
        {selectedUser && (
          <div className="luxury-card p-6">
            <h3 className="text-xl font-bold mb-4">User Actions</h3>
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => handleAdminAction("block", selectedUser.userId)}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                🚫 Block User
              </button>
              <button
                onClick={() =>
                  handleAdminAction("unblock", selectedUser.userId)
                }
                className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700"
              >
                ✅ Unblock User
              </button>
              <button
                onClick={() =>
                  handleAdminAction("revoke_sessions", selectedUser.userId)
                }
                className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
              >
                🚪 Revoke Sessions
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User Results */}
      <div className="luxury-card p-6">
        <h3 className="text-xl font-bold mb-4">Search Results</h3>
        <div className="space-y-3">
          {userSearchResults.length > 0 ? (
            userSearchResults.map((user) => (
              <div
                key={user.id}
                onClick={() => setSelectedUser(user)}
                className={`p-4 border rounded cursor-pointer hover:bg-gray-50 ${
                  selectedUser?.userId === user.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">
                      {user.name || user.email}
                    </div>
                    <div className="text-sm text-gray-600">{user.email}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Joined: {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className={`px-2 py-1 text-xs rounded ${
                        user.role === "admin"
                          ? "bg-purple-100 text-purple-800"
                          : user.role === "super_admin"
                          ? "bg-red-100 text-red-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {user.role || "user"}
                    </div>
                    <div
                      className={`px-2 py-1 text-xs rounded mt-1 ${
                        user.isBlocked
                          ? "bg-red-100 text-red-800"
                          : "bg-green-100 text-green-800"
                      }`}
                    >
                      {user.isBlocked ? "Blocked" : "Active"}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : userSearchLoading ? (
            <div className="text-center py-8">Searching users...</div>
          ) : userSearchQuery && !userSearchLoading ? (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">🔍</div>
              <p>No users found</p>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">👤</div>
              <p>Search for a user to see their details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const LogsTab = () => (
    <div className="space-y-4">
      <h3 className="text-xl font-bold">Admin Action Logs</h3>
      {logsLoading ? (
        <div className="text-center py-8">Loading logs...</div>
      ) : adminLogs.length > 0 ? (
        <div className="space-y-3">
          {adminLogs.map((log) => (
            <div key={log.id} className="luxury-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-start space-x-3">
                  <div className="text-lg">
                    {log.action === "BLOCK_USER"
                      ? "🚫"
                      : log.action === "UNBLOCK_USER"
                      ? "✅"
                      : log.action === "REVOKE_SESSIONS"
                      ? "🚪"
                      : log.action === "VIEW_USER_DATA"
                      ? "👁️"
                      : "⚙️"}
                  </div>
                  <div>
                    <div className="font-semibold">
                      {log.action.replace(/_/g, " ")}
                    </div>
                    <div className="text-sm text-gray-600">
                      {log.admin.email} →{" "}
                      {log.targetUser ? log.targetUser.email : "System"}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {new Date(log.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div
                  className={`px-2 py-1 text-xs rounded ${
                    log.success
                      ? "bg-green-100 text-green-800"
                      : "bg-red-100 text-red-800"
                  }`}
                >
                  {log.success ? "Success" : "Failed"}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <div className="text-4xl mb-2">📝</div>
          <p>No admin logs available</p>
        </div>
      )}
    </div>
  );

  const ConfirmationModal = ({ action, onConfirm, onCancel, loading }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="luxury-card p-6 max-w-md w-full mx-4">
        <h3 className="text-xl font-bold mb-4">Confirm Action</h3>
        <p className="text-gray-600 mb-6">
          Are you sure you want to {action.type.replace("_", " ")} this user?
          {action.reason && ` Reason: ${action.reason}`}
        </p>
        <div className="flex space-x-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? "Processing..." : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="luxury-card p-6 bg-gradient-to-r from-red-600 via-purple-600 to-blue-600 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-2">🛡️ Admin Command Center</h2>
            <p className="text-purple-100">
              System monitoring and administration for VaultBank
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="px-3 py-1 bg-white/20 rounded-full text-sm">
              🔒 Admin Mode - {user?.role}
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
              { id: "overview", label: "📊 Overview", icon: "📊" },
              { id: "alerts", label: "🚨 Alerts", icon: "🚨" },
              { id: "risk", label: "🎯 Risk Analytics", icon: "🎯" },
              { id: "aml", label: "🔍 AML Cases", icon: "🔍" },
              { id: "users", label: "👥 Users", icon: "👥" },
              { id: "logs", label: "📋 Audit Logs", icon: "📋" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
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
          {activeTab === "overview" && <OverviewTab />}
          {activeTab === "alerts" && <AlertsTab />}
          {activeTab === "risk" && <RiskTab />}
          {activeTab === "aml" && <AMLTab />}
          {activeTab === "users" && <UsersTab />}
          {activeTab === "logs" && <LogsTab />}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmAction && (
        <ConfirmationModal
          action={confirmAction}
          onConfirm={handleActionConfirm}
          onCancel={() => setConfirmAction(null)}
          loading={actionLoading}
        />
      )}
    </div>
  );
};

export default AdminCommandCenter;
