import { useState, useEffect, useCallback } from "react";
import { useErrorToast, useSuccessToast } from "./NotificationContainer";
import { api } from "../config/apiConfig";

const SecurityDashboard = ({ user, onAdminSearch }) => {
  const [activeTab, setActiveTab] = useState("overview");
  const [securityData, setSecurityData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [adminView, setAdminView] = useState(false);
  const [adminSearchEmail, setAdminSearchEmail] = useState("");
  const [adminSearchResult, setAdminSearchResult] = useState(null);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  const errorToast = useErrorToast();
  const successToast = useSuccessToast();

  const fetchSecurityData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get("security/me");

      if (data.success) {
        setSecurityData(data.data);
      } else {
        errorToast(data.message || "Failed to load security data");
      }
    } catch (error) {
      console.error("Security dashboard error:", error);
      errorToast("Failed to load security dashboard");
    } finally {
      setLoading(false);
    }
  }, [errorToast]);

  useEffect(() => {
    fetchSecurityData();
  }, [fetchSecurityData]);

  const handleAdminSearch = async (e) => {
    e.preventDefault();
    if (!adminSearchEmail.trim()) return;

    try {
      setLoadingAdmin(true);
      const data = await api.get(`security/admin/${adminSearchEmail.trim()}`);

      if (data.success) {
        setAdminSearchResult(data.data);
        setAdminSearchEmail("");
        setAdminView(true);
        successToast("Security profile loaded successfully");
      } else {
        errorToast(data.message || "Failed to load user security profile");
      }
    } catch (error) {
      console.error("Admin search error:", error);
      errorToast("Failed to search user");
    } finally {
      setLoadingAdmin(false);
    }
  };

  const revokeDevice = async (deviceId) => {
    try {
      const data = await api.post(`security/devices/${deviceId}/revoke`, {
        reason: "user_requested",
      });

      if (data.success) {
        successToast("Device access revoked successfully");

        // Refresh security data
        if (adminView) {
          setAdminView(false);
          setAdminSearchResult(null);
        } else {
          await fetchSecurityData();
        }
      } else {
        errorToast(data.message || "Failed to revoke device");
      }
    } catch (error) {
      console.error("Device revoke error:", error);
      errorToast("Failed to revoke device access");
    }
  };

  const getRiskColor = (score) => {
    if (score >= 70) return "text-red-600 bg-red-100";
    if (score >= 35) return "text-yellow-600 bg-yellow-100";
    return "text-green-600 bg-green-100";
  };

  const getRiskLevelText = (score) => {
    if (score >= 70) return "Critical";
    if (score >= 35) return "Medium";
    return "Low";
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleString();
  };

  const formatRelativeTime = (dateString) => {
    if (!dateString) return "Never";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getActivityIcon = (action) => {
    const iconMap = {
      login: "🔓",
      logout: "🔒",
      transfer: "💸",
      password_change: "🔑",
      mfa_enabled: "🛡️",
      mfa_disabled: "⚠️",
      RISK_EVALUATION: "🛡️",
      SECURITY_DASHBOARD_ACCESS: "👁️",
      DEVICE_SESSION_REVOKED: "🚫",
    };
    return iconMap[action] || "📝";
  };

  const currentData = adminView ? adminSearchResult : securityData;
  const isAdminView = user?.role === "admin" || user?.isAdmin;

  if (loading) {
    return (
      <div className="luxury-card p-8 animate-pulse">
        <div className="h-8 bg-gradient-to-r from-gray-300 to-gray-400 rounded mb-6"></div>
        <div className="space-y-4">
          <div className="h-12 bg-gray-300 rounded"></div>
          <div className="h-12 bg-gray-300 rounded"></div>
          <div className="h-12 bg-gray-300 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="luxury-card p-6 bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold mb-2">🛡️ Security Dashboard</h2>
            <p className="text-blue-100">
              {adminView
                ? "Administrator Security Analysis"
                : "Monitor your account security & activity"}
            </p>
          </div>
          {isAdminView && !adminView && (
            <div className="flex items-center space-x-4">
              <div className="px-3 py-1 bg-white/20 rounded-full text-sm">
                🔍 Admin Mode
              </div>
            </div>
          )}
          {adminView && (
            <button
              onClick={() => {
                setAdminView(false);
                setAdminSearchResult(null);
              }}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors"
            >
              ← Back to My Security
            </button>
          )}
        </div>
      </div>

      {/* Admin Search */}
      {isAdminView && !adminView && (
        <div className="luxury-card p-6">
          <h3 className="text-xl font-bold mb-4">🔍 Analyze User Security</h3>
          <form onSubmit={handleAdminSearch} className="flex space-x-4">
            <input
              type="email"
              placeholder="Enter user email to analyze..."
              value={adminSearchEmail}
              onChange={(e) => setAdminSearchEmail(e.target.value)}
              className="flex-1 p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
            <button
              type="submit"
              disabled={loadingAdmin}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50"
            >
              {loadingAdmin ? "🔍 Searching..." : "🔍 Analyze"}
            </button>
          </form>
        </div>
      )}

      {/* Security Overview Cards */}
      {currentData?.summary && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">🛡️</div>
            <div
              className={`text-2xl font-bold ${getRiskColor(
                currentData.summary.riskScore || 0,
              )} mx-auto w-fit px-3 py-1 rounded-full`}
            >
              {currentData.summary.riskScore || 0}
            </div>
            <div className="text-sm text-gray-600 mt-1">Risk Score</div>
          </div>

          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">🔐</div>
            <div className="text-2xl font-bold text-blue-600">
              {currentData.devices?.length || 0}
            </div>
            <div className="text-sm text-gray-600 mt-1">Active Devices</div>
          </div>

          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">🔔</div>
            <div className="text-2xl font-bold text-orange-600">
              {currentData.summary.unreadAlerts || 0}
            </div>
            <div className="text-sm text-gray-600 mt-1">New Alerts</div>
          </div>

          <div className="luxury-card p-6 text-center">
            <div className="text-4xl mb-2">⚠️</div>
            <div className="text-2xl font-bold text-red-600">
              {currentData.summary.suspiciousActivities || 0}
            </div>
            <div className="text-sm text-gray-600 mt-1">Suspicious Events</div>
          </div>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="luxury-card">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8 px-6">
            {[
              { id: "overview", label: "📊 Overview", icon: "📊" },
              { id: "activity", label: "🔍 Activity", icon: "🔍" },
              { id: "alerts", label: "🔔 Alerts", icon: "🔔" },
              { id: "devices", label: "📱 Devices", icon: "📱" },
              { id: "settings", label: "⚙️ Security Settings", icon: "⚙️" },
              ...(adminView
                ? [{ id: "metrics", label: "📈 Metrics", icon: "📈" }]
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

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Risk Profile */}
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">🎯 Risk Assessment</h3>
                  <div className="luxury-card p-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-semibold">Current Risk Level</span>
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-medium ${getRiskColor(
                          currentData?.riskProfile?.currentScore || 0,
                        )}`}
                      >
                        {getRiskLevelText(
                          currentData?.riskProfile?.currentScore || 0,
                        )}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-4 mb-2">
                      <div
                        className={`h-4 rounded-full transition-all duration-300 ${
                          (currentData?.riskProfile?.currentScore || 0) >= 70
                            ? "bg-red-500"
                            : (currentData?.riskProfile?.currentScore || 0) >=
                                35
                              ? "bg-yellow-500"
                              : "bg-green-500"
                        }`}
                        style={{
                          width: `${Math.min(
                            currentData?.riskProfile?.currentScore || 0,
                            100,
                          )}%`,
                        }}
                      ></div>
                    </div>
                    <p className="text-sm text-gray-600">
                      Last assessed:{" "}
                      {formatRelativeTime(
                        currentData?.riskProfile?.lastAssessment,
                      )}
                    </p>
                  </div>
                </div>

                {/* Security Status */}
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">🛡️ Security Status</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between luxury-card p-3">
                      <span className="flex items-center space-x-2">
                        <span>🔐</span>
                        <span>MFA Enabled</span>
                      </span>
                      <span
                        className={
                          currentData?.summary?.mfaEnabled
                            ? "text-green-600 font-semibold"
                            : "text-red-600"
                        }
                      >
                        {currentData?.summary?.mfaEnabled
                          ? "✓ Active"
                          : "✗ Disabled"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between luxury-card p-3">
                      <span className="flex items-center space-x-2">
                        <span>📧</span>
                        <span>Email Verified</span>
                      </span>
                      <span
                        className={
                          currentData?.summary?.emailVerified
                            ? "text-green-600 font-semibold"
                            : "text-red-600"
                        }
                      >
                        {currentData?.summary?.emailVerified
                          ? "✓ Verified"
                          : "✗ Unverified"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between luxury-card p-3">
                      <span className="flex items-center space-x-2">
                        <span>📱</span>
                        <span>Phone Verified</span>
                      </span>
                      <span
                        className={
                          currentData?.summary?.phoneVerified
                            ? "text-green-600 font-semibold"
                            : "text-red-600"
                        }
                      >
                        {currentData?.summary?.phoneVerified
                          ? "✓ Verified"
                          : "✗ Unverified"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Activity Tab */}
          {activeTab === "activity" && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">📋 Recent Activity</h3>
              <div className="space-y-3">
                {currentData?.recentActivity?.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-center justify-between luxury-card p-4"
                  >
                    <div className="flex items-center space-x-4">
                      <div className="text-2xl">
                        {getActivityIcon(activity.action)}
                      </div>
                      <div>
                        <div className="font-semibold capitalize">
                          {activity.action.replace(/_/g, " ")}
                        </div>
                        <div className="text-sm text-gray-600">
                          {formatRelativeTime(activity.timestamp)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`px-2 py-1 rounded text-xs ${
                          activity.success
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {activity.success ? "Success" : "Failed"}
                      </div>
                      {activity.riskScore > 0 && (
                        <div className="text-xs text-gray-500 mt-1">
                          Risk: {activity.riskScore}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {(!currentData?.recentActivity ||
                  currentData.recentActivity.length === 0) && (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">📭</div>
                    <p>No recent activity found</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Alerts Tab */}
          {activeTab === "alerts" && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">🔔 Security Alerts</h3>
              <div className="space-y-3">
                {currentData?.alerts?.map((alert) => (
                  <div
                    key={alert.id}
                    className={`luxury-card p-4 border-l-4 ${
                      alert.severity === "critical"
                        ? "border-red-500"
                        : alert.severity === "warning"
                          ? "border-yellow-500"
                          : "border-blue-500"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-start space-x-3">
                        <div className="text-2xl">
                          {alert.severity === "critical"
                            ? "🚨"
                            : alert.severity === "warning"
                              ? "⚠️"
                              : "ℹ️"}
                        </div>
                        <div>
                          <h4 className="font-semibold">{alert.title}</h4>
                          <p className="text-sm text-gray-600">
                            {alert.message}
                          </p>
                          <div className="text-xs text-gray-500 mt-1">
                            {formatRelativeTime(alert.timestamp)}
                          </div>
                        </div>
                      </div>
                      {!alert.read && (
                        <div className="w-3 h-3 bg-blue-500 rounded-full flex-shrink-0"></div>
                      )}
                    </div>
                  </div>
                ))}
                {(!currentData?.alerts || currentData.alerts.length === 0) && (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">✅</div>
                    <p>No security alerts at this time</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Devices Tab */}
          {activeTab === "devices" && (
            <div className="space-y-4">
              <h3 className="text-xl font-bold">
                📱 Active Devices & Sessions
              </h3>
              <div className="space-y-3">
                {currentData?.devices?.map((device) => (
                  <div key={device.id} className="luxury-card p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="text-3xl">📱</div>
                        <div>
                          <div className="font-semibold">
                            {device.deviceInfo?.os || "Unknown"} •{" "}
                            {device.deviceInfo?.browser || "Unknown"}
                          </div>
                          <div className="text-sm text-gray-600">
                            {device.location?.city || "Unknown"},{" "}
                            {device.location?.country || "Unknown"}
                            {device.isCurrentSession && (
                              <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                                Current Session
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            Last active: {formatRelativeTime(device.lastLogin)}{" "}
                            • IP: {device.ipAddress}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="mb-2">
                          <span
                            className={`px-2 py-1 rounded text-xs ${getRiskColor(
                              device.riskScore,
                            )}`}
                          >
                            Risk: {getRiskLevelText(device.riskScore)}
                          </span>
                        </div>
                        {!device.isCurrentSession && !adminView && (
                          <button
                            onClick={() => revokeDevice(device.id)}
                            className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors"
                          >
                            Revoke Access
                          </button>
                        )}
                        {adminView && (
                          <button
                            onClick={() => revokeDevice(device.id)}
                            className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600 transition-colors"
                          >
                            Admin Revoke
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {(!currentData?.devices ||
                  currentData.devices.length === 0) && (
                  <div className="text-center py-8 text-gray-500">
                    <div className="text-4xl mb-2">📱</div>
                    <p>No active devices found</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Security Settings Tab */}
          {activeTab === "settings" && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold">⚙️ Security Settings</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* MFA Settings */}
                <div className="luxury-card p-6">
                  <h4 className="text-lg font-semibold mb-4">
                    🔐 Multi-Factor Authentication
                  </h4>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">MFA Status</span>
                      <span
                        className={`${
                          currentData?.summary?.mfaEnabled
                            ? "text-green-600"
                            : "text-red-600"
                        } font-semibold`}
                      >
                        {currentData?.summary?.mfaEnabled
                          ? "Enabled"
                          : "Disabled"}
                      </span>
                    </div>
                    {currentData?.summary?.mfaMethod && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm">MFA Method</span>
                        <span className="font-medium capitalize">
                          {currentData.summary.mfaMethod}
                        </span>
                      </div>
                    )}
                    {!currentData?.summary?.mfaEnabled && (
                      <button className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                        Enable MFA
                      </button>
                    )}
                  </div>
                </div>

                {/* Password Settings */}
                <div className="luxury-card p-6">
                  <h4 className="text-lg font-semibold mb-4">
                    🔑 Password Security
                  </h4>
                  <div className="space-y-4">
                    <button className="w-full py-2 px-4 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors">
                      Change Password
                    </button>
                    <p className="text-xs text-gray-600">
                      Last password change: Not available
                    </p>
                  </div>
                </div>

                {/* Advanced Security */}
                <div className="luxury-card p-6 lg:col-span-2">
                  <h4 className="text-lg font-semibold mb-4">
                    🔒 Advanced Security
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button className="py-3 px-4 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors">
                      Export Security Data
                    </button>
                    <button className="py-3 px-4 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors">
                      Login Alerts
                    </button>
                    <button className="py-3 px-4 bg-red-600 text-white rounded hover:bg-red-700 transition-colors">
                      Emergency Lock
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Admin Metrics Tab */}
          {activeTab === "metrics" && adminView && (
            <div className="space-y-6">
              <h3 className="text-xl font-bold">📊 Security Metrics</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-2">📈</div>
                  <div className="text-2xl font-bold">
                    {currentData?.securityMetrics?.totalActivities || 0}
                  </div>
                  <div className="text-sm text-gray-600">Total Activities</div>
                </div>
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-2">❌</div>
                  <div className="text-2xl font-bold text-red-600">
                    {currentData?.securityMetrics?.failedActivities || 0}
                  </div>
                  <div className="text-sm text-gray-600">Failed Activities</div>
                </div>
                <div className="luxury-card p-6 text-center">
                  <div className="text-4xl mb-2">📱</div>
                  <div className="text-2xl font-bold">
                    {currentData?.securityMetrics?.totalSessions || 0}
                  </div>
                  <div className="text-sm text-gray-600">Total Sessions</div>
                </div>
              </div>

              <div className="luxury-card p-6">
                <h4 className="text-lg font-semibold mb-4">
                  📈 Risk Assessment History
                </h4>
                <div className="space-y-3">
                  {currentData?.riskHistory?.map((risk) => (
                    <div
                      key={risk.timestamp}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded"
                    >
                      <div>
                        <div className="font-medium">
                          {formatDate(risk.timestamp)}
                        </div>
                        <div className="text-sm text-gray-600">
                          Rules triggered: {risk.rulesTriggered?.length || 0}
                        </div>
                      </div>
                      <div
                        className={`px-3 py-1 rounded-full text-sm font-medium ${getRiskColor(
                          risk.score,
                        )}`}
                      >
                        Score: {risk.score}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SecurityDashboard;
