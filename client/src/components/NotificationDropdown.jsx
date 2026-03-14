import { useState, useEffect } from "react";
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

export default function NotificationDropdown({ isOpen, onClose }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const successToast = useSuccessToast();
  const errorToast = useErrorToast();

  // Load notifications
  const loadNotifications = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/alerts?limit=5", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setNotifications(data.alerts);
        setUnreadCount(data.alerts.filter((alert) => !alert.read).length);
      }
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  // Load unread count
  const loadUnreadCount = async () => {
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
  };

  // Load data when dropdown opens
  useEffect(() => {
    if (isOpen) {
      loadNotifications();
      loadUnreadCount();
    }
  }, [isOpen]);

  // Mark notification as read
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
        setNotifications((prev) =>
          prev.map((alert) =>
            alert.id === alertId ? { ...alert, read: true } : alert
          )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
        successToast("Notification marked as read");
      }
    } catch (error) {
      console.error("Mark as read error:", error);
      errorToast("Failed to mark notification as read");
    }
  };

  // Dismiss notification
  const dismissNotification = async (alertId) => {
    try {
      const response = await fetch(`/api/alerts/${alertId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setNotifications((prev) =>
          prev.filter((alert) => alert.id !== alertId)
        );
        successToast("Notification dismissed");
      }
    } catch (error) {
      console.error("Dismiss notification error:", error);
      errorToast("Failed to dismiss notification");
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

  if (!isOpen) return null;

  return (
    <div className="absolute right-0 mt-2 w-96 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-50">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Notifications</h3>
          {unreadCount > 0 && (
            <span className="px-2 py-1 bg-red-600 text-white text-xs rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-400"></div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <div className="text-2xl mb-2">📭</div>
            <p>No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {notifications.map((notification) => {
              const severityStyle =
                ALERT_SEVERITIES[notification.severity] ||
                ALERT_SEVERITIES.info;

              return (
                <div
                  key={notification.id}
                  className={`p-4 hover:bg-gray-700/50 transition-colors ${
                    !notification.read ? severityStyle.bg : ""
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    {/* Icon */}
                    <div className="flex-shrink-0 mt-1">
                      <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-sm">
                        {ALERT_ICONS[notification.type] || "🔔"}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded ${severityStyle.color} bg-gray-700`}
                        >
                          {notification.severity.toUpperCase()}
                        </span>
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded capitalize ${severityStyle.color} bg-gray-700`}
                        >
                          {notification.type}
                        </span>
                        {!notification.read && (
                          <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                        )}
                      </div>

                      <p className="text-gray-200 text-sm leading-relaxed mb-2">
                        {notification.message}
                      </p>

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">
                          {formatTimestamp(notification.createdAt)}
                        </span>

                        <div className="flex space-x-1">
                          {!notification.read && (
                            <button
                              onClick={() => markAsRead(notification.id)}
                              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                            >
                              Read
                            </button>
                          )}
                          <button
                            onClick={() => dismissNotification(notification.id)}
                            className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                          >
                            ✕
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
      </div>

      {notifications.length > 0 && (
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={() => {
              onClose();
              // Navigate to AlertsCenter - you'd implement this based on your routing
              window.location.href = "/alerts";
            }}
            className="w-full py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded hover:from-blue-700 hover:to-purple-700 transition-all duration-300 text-sm font-semibold"
          >
            View All Notifications
          </button>
        </div>
      )}
    </div>
  );
}
