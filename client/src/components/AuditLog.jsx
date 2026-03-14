export default function AuditLog({ user, subscription }) {
  // Mock audit log data - in real app, this would come from backend
  const generateMockAuditLogs = () => {
    const logs = [];
    const now = new Date();

    // Generate sample logs for the last 30 days
    for (let i = 0; i < 15; i++) {
      const logDate = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const randomAction = getRandomAction();
      const randomIP = `192.168.${Math.floor(Math.random() * 255)}.${Math.floor(
        Math.random() * 255
      )}`;

      logs.push({
        id: Date.now() - i,
        timestamp: logDate.toISOString(),
        action: randomAction.action,
        details: randomAction.details,
        ip: randomIP,
        status: Math.random() > 0.1 ? "success" : "failed", // 90% success rate
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      });
    }

    return logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  const getRandomAction = () => {
    const actions = [
      { action: "LOGIN", details: "User logged in successfully" },
      { action: "LOGOUT", details: "User logged out" },
      {
        action: "TRANSFER",
        details: `Transfer of $${(Math.random() * 1000).toFixed(2)} completed`,
      },
      { action: "PASSWORD_CHANGE", details: "Password updated successfully" },
      { action: "PROFILE_UPDATE", details: "Profile information modified" },
      { action: "BUDGET_SET", details: "Monthly budget configured" },
      { action: "GOAL_CREATE", details: "New savings goal created" },
      { action: "CARD_USE", details: "Virtual card transaction" },
      { action: "EXPORT_DATA", details: "Financial data exported" },
      { action: "SETTINGS_CHANGE", details: "Dashboard settings updated" },
      { action: "MFA_ENABLED", details: "Two-factor authentication enabled" },
      { action: "FAILED_LOGIN", details: "Login attempt failed" },
    ];

    return actions[Math.floor(Math.random() * actions.length)];
  };

  const auditLogs = generateMockAuditLogs();

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getStatusIcon = (status) => {
    return status === "success" ? (
      <span className="text-green-400">✓</span>
    ) : (
      <span className="text-red-400">✗</span>
    );
  };

  const getActionIcon = (action) => {
    const icons = {
      LOGIN: "🔐",
      LOGOUT: "🚪",
      TRANSFER: "💸",
      PASSWORD_CHANGE: "🔑",
      PROFILE_UPDATE: "👤",
      BUDGET_SET: "📊",
      GOAL_CREATE: "🎯",
      CARD_USE: "💳",
      EXPORT_DATA: "📤",
      SETTINGS_CHANGE: "⚙️",
      MFA_ENABLED: "🛡️",
      FAILED_LOGIN: "⚠️",
    };
    return icons[action] || "📝";
  };

  return (
    <div className="bg-gray-900 text-white p-6 rounded-xl shadow-xl mt-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold flex items-center space-x-2">
          <span>📋</span>
          <span>Audit Logs</span>
        </h2>
        <div className="text-sm text-gray-400">
          Last 30 days • {auditLogs.length} events
        </div>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {auditLogs.map((log) => (
          <div
            key={log.id}
            className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start space-x-3">
                <div className="text-2xl">{getActionIcon(log.action)}</div>
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="font-semibold text-white">
                      {log.action}
                    </span>
                    {getStatusIcon(log.status)}
                  </div>
                  <p className="text-sm text-gray-300 mb-2">{log.details}</p>
                  <div className="text-xs text-gray-500 space-y-1">
                    <p>📅 {formatDate(log.timestamp)}</p>
                    <p>🌐 IP: {log.ip}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-blue-900/20 rounded-lg border border-blue-700">
        <div className="flex items-center space-x-2 mb-2">
          <span className="text-xl">🔒</span>
          <span className="font-semibold text-blue-400">Security Notice</span>
        </div>
        <p className="text-sm text-gray-300">
          All user activities are logged and monitored for security purposes.
          Suspicious activities trigger immediate alerts to our security team.
        </p>
      </div>
    </div>
  );
}
