import { useState, useEffect, useCallback } from "react";
import { useLog, LOG_EVENTS } from "../hooks/useLog";
import { useSuccessToast, useErrorToast } from "./NotificationContainer";

const ALERT_ICONS = {
  fraud: "🔒",
  budget: "💸",
  goal: "🎯",
  system: "⚙️",
  transfer: "💳",
  login: "🔑",
  mfa: "🛡️",
  subscription: "⭐",
  security: "🔐",
};

const ALERT_SEVERITIES = {
  info: {
    color: "text-blue-400",
    bg: "bg-blue-900/20",
    border: "border-blue-500/50",
  },
  warning: {
    color: "text-yellow-400",
    bg: "bg-yellow-900/20",
    border: "border-yellow-500/50",
  },
  critical: {
    color: "text-red-400",
    bg: "bg-red-900/20",
    border: "border-red-500/50",
  },
};

export default function AlertsCenter() {
  const [activeTab, setActiveTab] = useState("all");
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1,
    hasMore: false,
  });

  const log = useLog();
  const successToast = useSuccessToast();
  const errorToast = useErrorToast();

  // Tabs configuration
  const tabs = [
    { id: "all", label: "📋 All", count: alerts.length },
    { id: "unread", label: "📬 Unread", count: unreadCount },
    {
      id: "critical",
      label: "🚨 Critical",
      count: alerts.filter((a) => a.severity === "critical").length,
    },
  ];

  // Load unread count
  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/alerts/unread-count", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();
      if (data.success) {
        setUnreadCount(data.unreadCount);
      }
    } catch (error) {
      console.error("Failed to load unread count:", error);
    }
  }, []);

  // Load alerts
  const loadAlerts = useCallback(
    async (tab = activeTab) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/alerts?tab=${tab}&page=${pagination.page}&limit=${pagination.limit}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );

        const data = await response.json();

        if (data.success) {
          setAlerts(data.alerts);
          setPagination((prev) => ({
            ...prev,
            ...data.pagination,
          }));

          // Load unread count
          loadUnreadCount();

          await log(LOG_EVENTS.VIEW_ALERTS, { tab, count: data.alerts.length });
        } else {
          errorToast(data.message || "Failed to load alerts");
        }
      } catch (error) {
        console.error("Failed to load alerts:", error);
        errorToast("Failed to load alerts");
      } finally {
        setLoading(false);
      }
    },
    [
      activeTab,
      pagination.page,
      pagination.limit,
      loadUnreadCount,
      log,
      errorToast,
    ]
  );

  // Memoize loadAlerts to prevent unnecessary re-renders
  const memoizedLoadAlerts = useCallback(async () => {
    await loadAlerts(activeTab);
  }, [activeTab, loadAlerts]);

  // Load alerts on tab change or component mount
  useEffect(() => {
    memoizedLoadAlerts();
  }, [memoizedLoadAlerts]);

  // Mark alert as read
  const markAsRead = async (alertId) => {
    try {
      const response = await fetch(`/api/alerts/${alertId}/read`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setAlerts((prev) =>
          prev.map((alert) =>
            alert.id === alertId ? { ...alert, read: true } : alert
          )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
        successToast("Alert marked as read");

        await log(LOG_EVENTS.ALERT_READ, { alertId });
      } else {
        errorToast(data.message || "Failed to mark alert as read");
      }
    } catch (error) {
      console.error("Mark as read error:", error);
      errorToast("Failed to mark alert as read");
    }
  };

  // Dismiss alert
  const dismissAlert = async (alertId) => {
    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setAlerts((prev) => prev.filter((alert) => alert.id !== alertId));
        successToast("Alert dismissed");

        await log(LOG_EVENTS.ALERT_DISMISSED, { alertId });
      } else {
        errorToast(data.message || "Failed to dismiss alert");
      }
    } catch (error) {
      console.error("Dismiss alert error:", error);
      errorToast("Failed to dismiss alert");
    }
  };

  // Create test alerts (for development)
  const createTestAlerts = async () => {
    const testAlerts = [
      {
        type: "fraud",
        message:
          "Unusual transaction detected: $500 purchase in Tokyo. If this wasn't you, please contact support immediately.",
        severity: "critical",
      },
      {
        type: "budget",
        message:
          "You've spent 85% of your monthly budget on entertainment. Consider reviewing your expenses.",
        severity: "warning",
      },
      {
        type: "goal",
        message:
          "You're 75% towards your vacation savings goal! Keep up the great work.",
        severity: "info",
      },
      {
        type: "system",
        message:
          "Welcome to your new VaultBank alerts center! You can now stay informed about your account activity.",
        severity: "info",
      },
      {
        type: "transfer",
        message:
          "₹500 sent to john@example.com successfully. Transfer completed in real-time!",
        severity: "info",
      },
      {
        type: "login",
        message:
          "New login detected from Chrome on Windows. If this wasn't you, please contact support.",
        severity: "warning",
      },
      {
        type: "mfa",
        message:
          "Two-factor authentication enabled successfully. Your account is now more secure!",
        severity: "info",
      },
      {
        type: "subscription",
        message:
          "Upgraded to Premium Yearly plan for ₹99/year. Welcome to the elite tier!",
        severity: "info",
      },
      {
        type: "security",
        message:
          "Profile information updated. Security settings have been modified.",
        severity: "info",
      },
    ];

    try {
      const promises = testAlerts.map((alert) =>
        fetch("/api/alerts/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify(alert),
        })
      );

      const responses = await Promise.all(promises);
      const results = await Promise.all(responses.map((r) => r.json()));

      const successCount = results.filter((r) => r.success).length;

      if (successCount > 0) {
        successToast(`Created ${successCount} test alerts`);
        loadAlerts();
        await log(LOG_EVENTS.TEST_DATA_CREATED, {
          alertsCreated: successCount,
        });
      }
    } catch (error) {
      console.error("Create test alerts error:", error);
      errorToast("Failed to create test alerts");
    }
  };

  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) {
      return "Just now";
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  if (loading && alerts.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-gradient-to-br from-indigo-900 to-purple-900 text-white rounded-xl shadow-xl overflow-hidden">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold">🔔 Notifications & Alerts</h1>
            <button
              onClick={createTestAlerts}
              className="px-4 py-2 bg-gradient-to-r from-yellow-500 to-orange-600 text-black font-bold rounded hover:from-yellow-400 hover:to-orange-500 transition-all duration-300 text-sm"
            >
              Create Test Alerts
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="flex flex-wrap border-b border-gray-700 mb-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 font-semibold transition-colors flex items-center space-x-2 ${
                  activeTab === tab.id
                    ? "text-yellow-400 border-b-2 border-yellow-400"
                    : "text-gray-300 hover:text-white"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-2 py-1 text-xs rounded-full ${
                    activeTab === tab.id
                      ? "bg-yellow-400 text-black"
                      : "bg-gray-700 text-gray-300"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Alerts List */}
          <div className="min-h-96">
            {alerts.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">📭</div>
                <h3 className="text-xl font-semibold mb-2">No alerts found</h3>
                <p className="text-gray-400">
                  {activeTab === "unread"
                    ? "You have no unread alerts!"
                    : activeTab === "critical"
                    ? "No critical alerts at this time."
                    : "Your notifications and alerts will appear here."}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {alerts.map((alert) => {
                  const severityStyle =
                    ALERT_SEVERITIES[alert.severity] || ALERT_SEVERITIES.info;

                  return (
                    <div
                      key={alert.id}
                      className={`p-4 rounded-lg border transition-all duration-300 hover:shadow-lg ${
                        alert.read ? "bg-gray-800/30" : severityStyle.bg
                      } ${severityStyle.border} border-l-4`}
                    >
                      <div className="flex items-start space-x-4">
                        {/* Icon */}
                        <div className="flex-shrink-0">
                          <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center text-2xl">
                            {ALERT_ICONS[alert.type] || "🔔"}
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-3 mb-2">
                            <span
                              className={`px-2 py-1 text-xs font-semibold rounded ${severityStyle.color} bg-gray-700`}
                            >
                              {alert.severity.toUpperCase()}
                            </span>
                            <span
                              className={`px-2 py-1 text-xs font-semibold rounded capitalize ${severityStyle.color} bg-gray-700`}
                            >
                              {alert.type}
                            </span>
                            {!alert.read && (
                              <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                            )}
                          </div>

                          <p className="text-gray-200 text-sm leading-relaxed mb-3">
                            {alert.message}
                          </p>

                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">
                              {formatTimestamp(alert.createdAt)}
                            </span>

                            <div className="flex space-x-2">
                              {!alert.read && (
                                <button
                                  onClick={() => markAsRead(alert.id)}
                                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                                >
                                  Mark Read
                                </button>
                              )}
                              <button
                                onClick={() => dismissAlert(alert.id)}
                                className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                              >
                                Dismiss
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Load More Button */}
            {pagination.hasMore && (
              <div className="text-center mt-6">
                <button
                  onClick={() => {
                    setPagination((prev) => ({ ...prev, page: prev.page + 1 }));
                    loadAlerts();
                  }}
                  disabled={loading}
                  className="px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-600 text-black font-bold rounded hover:from-yellow-400 hover:to-orange-500 transition-all duration-300 disabled:opacity-50"
                >
                  {loading ? "Loading..." : "Load More Alerts"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
