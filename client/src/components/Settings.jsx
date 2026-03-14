import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useLog, LOG_EVENTS } from "../hooks/useLog";
import { useSuccessToast, useErrorToast } from "./NotificationContainer";

export default function Settings({ subscription }) {
  const [activeTab, setActiveTab] = useState("profile");
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState({});
  const [settings, setSettings] = useState({});
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    mfaCode: "",
    confirmText: "",
  });
  const [auditLogs, setAuditLogs] = useState([]);

  const navigate = useNavigate();
  const log = useLog();
  const successToast = useSuccessToast();
  const errorToast = useErrorToast();

  // Tabs configuration
  const tabs = [
    { id: "profile", label: "👤 Profile", icon: "👤" },
    { id: "security", label: "🔐 Security", icon: "🔐" },
    { id: "preferences", label: "⚙️ Preferences", icon: "⚙️" },
    { id: "data", label: "📊 Data", icon: "📊" },
  ];

  // Supported currencies and languages
  const currencies = ["USD", "EUR", "INR", "GBP", "CAD", "AUD"];
  const languages = [
    { code: "en", name: "English" },
    { code: "hi", name: "हिंदी (Hindi)" },
  ];

  // Load user data on component mount
  useEffect(() => {
    const loadUserData = async () => {
      setLoading(true);
      try {
        // Load profile
        const profileResponse = await fetch("/api/profile/profile", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });

        const profileData = await profileResponse.json();
        if (profileData.success) {
          setProfile(profileData.profile);
          setFormData((prev) => ({
            ...prev,
            name: profileData.profile.name || "",
            email: profileData.profile.email || "",
            phone: profileData.profile.phone || "",
          }));
        }

        // Load settings
        const settingsResponse = await fetch("/api/profile/settings", {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        });

        const settingsData = await settingsResponse.json();
        if (settingsData.success) {
          setSettings(settingsData.settings);
        }
      } catch (error) {
        console.error("Failed to load user data:", error);
        errorToast("Failed to load settings data");
      } finally {
        setLoading(false);
      }
    };

    // Load audit logs when security tab is active
    const loadAuditLogs = async () => {
      if (activeTab === "security") {
        try {
          const response = await fetch("/api/audit/me", {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          });

          const data = await response.json();
          if (data.success) {
            setAuditLogs(data.data.logs || []);
          }
        } catch (error) {
          console.error("Failed to load audit logs:", error);
        }
      }
    };

    loadUserData();
    loadAuditLogs();
  }, [errorToast, activeTab]);

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const updateData = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
      };

      const response = await fetch("/api/profile/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (data.success) {
        setProfile(data.profile);
        successToast("Profile updated successfully!");

        await log(LOG_EVENTS.SETTINGS_UPDATE, {
          section: "profile",
          fields: Object.keys(updateData),
        });
      } else {
        errorToast(data.message || "Failed to update profile");
      }
    } catch (error) {
      console.error("Profile update error:", error);
      errorToast("Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSettingsUpdate = async (field, value) => {
    setLoading(true);

    try {
      const updateData = { [field]: value };

      const response = await fetch("/api/profile/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(updateData),
      });

      const data = await response.json();

      if (data.success) {
        setSettings(data.settings);
        successToast("Settings updated successfully!");

        await log(LOG_EVENTS.SETTINGS_UPDATE, {
          section: "preferences",
          field,
          value,
        });
      } else {
        errorToast(data.message || "Failed to update settings");
      }
    } catch (error) {
      console.error("Settings update error:", error);
      errorToast("Failed to update settings");
    } finally {
      setLoading(false);
    }
  };

  const handleMFAToggle = async () => {
    if (!settings?.security?.mfaEnabled) {
      // Enable MFA (simulated)
      const code = prompt(
        "Enter MFA code to enable (for demo, enter any 6 digits):"
      );
      if (!code || !/^\d{6}$/.test(code)) {
        errorToast("Invalid MFA code");
        return;
      }
    }

    setLoading(true);
    try {
      const action = settings?.security?.mfaEnabled ? "disable" : "enable";

      const response = await fetch(`/api/profile/settings/mfa/${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          code: settings?.security?.mfaEnabled ? null : formData.mfaCode,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSettings((prev) => ({
          ...prev,
          security: {
            ...prev.security,
            mfaEnabled: data.mfaEnabled,
          },
        }));
        successToast(`MFA ${action}d successfully!`);
      } else {
        errorToast(data.message || `Failed to ${action} MFA`);
      }
    } catch (error) {
      console.error("MFA toggle error:", error);
      errorToast("Failed to update MFA settings");
    } finally {
      setLoading(false);
    }
  };

  const handleDataExport = async () => {
    try {
      const response = await fetch("/api/profile/settings/export", {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `vaultbank-data-${
          new Date().toISOString().split("T")[0]
        }.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);

        successToast("Data export completed!");
        await log(LOG_EVENTS.DATA_EXPORT, { format: "json" });
      } else {
        errorToast("Failed to export data");
      }
    } catch (error) {
      console.error("Data export error:", error);
      errorToast("Failed to export data");
    }
  };

  const handleAccountDeletion = async () => {
    if (formData.confirmText !== "DELETE") {
      errorToast('Please type "DELETE" to confirm');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/profile/settings/account", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ confirmText: formData.confirmText }),
      });

      const data = await response.json();

      if (data.success) {
        successToast("Account deletion initiated");
        setTimeout(() => {
          localStorage.removeItem("token");
          navigate("/login");
        }, 3000);
      } else {
        errorToast(data.message || "Failed to delete account");
      }
    } catch (error) {
      console.error("Account deletion error:", error);
      errorToast("Failed to delete account");
    } finally {
      setLoading(false);
    }
  };

  if (loading && !profile.email) {
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
          <h1 className="text-3xl font-bold mb-6 text-center">
            ⚙️ Account Settings
          </h1>

          {/* Tab Navigation */}
          <div className="flex flex-wrap border-b border-gray-700 mb-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 font-semibold transition-colors ${
                  activeTab === tab.id
                    ? "text-yellow-400 border-b-2 border-yellow-400"
                    : "text-gray-300 hover:text-white"
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="min-h-96">
            {/* Profile Tab */}
            {activeTab === "profile" && (
              <div className="space-y-6">
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center text-2xl">
                    👤
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold">
                      {profile.name || "User"}
                    </h3>
                    <p className="text-gray-300">
                      {profile.membershipTier || "Free"} Member
                    </p>
                  </div>
                </div>

                <form onSubmit={handleProfileUpdate} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block mb-2 font-semibold">
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        className="w-full p-3 rounded bg-gray-800 border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                        placeholder="Enter your full name"
                      />
                    </div>
                    <div>
                      <label className="block mb-2 font-semibold">
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            email: e.target.value,
                          }))
                        }
                        className="w-full p-3 rounded bg-gray-800 border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                        placeholder="Enter your email"
                      />
                    </div>
                    <div>
                      <label className="block mb-2 font-semibold">
                        Phone Number
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            phone: e.target.value,
                          }))
                        }
                        className="w-full p-3 rounded bg-gray-800 border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                        placeholder="Enter your phone number"
                      />
                    </div>
                    <div>
                      <label className="block mb-2 font-semibold">
                        Member Since
                      </label>
                      <input
                        type="text"
                        value={
                          profile.accountCreated
                            ? new Date(
                                profile.accountCreated
                              ).toLocaleDateString()
                            : "N/A"
                        }
                        readOnly
                        className="w-full p-3 rounded bg-gray-700 border border-gray-600 cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-600 text-black font-bold rounded hover:from-yellow-400 hover:to-orange-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? "Updating..." : "Update Profile"}
                  </button>
                </form>
              </div>
            )}

            {/* Security Tab */}
            {activeTab === "security" && (
              <div className="space-y-6">
                <h3 className="text-xl font-semibold mb-4">
                  🔐 Security Settings
                </h3>

                {/* MFA Section */}
                <div className="bg-gray-800/50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h4 className="font-semibold">
                        Two-Factor Authentication (MFA)
                      </h4>
                      <p className="text-sm text-gray-300">
                        Add an extra layer of security to your account
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span
                        className={`px-3 py-1 rounded text-sm ${
                          settings?.security?.mfaEnabled
                            ? "bg-green-600"
                            : "bg-gray-600"
                        }`}
                      >
                        {settings?.security?.mfaEnabled
                          ? "Enabled"
                          : "Disabled"}
                      </span>
                      <button
                        onClick={handleMFAToggle}
                        className={`px-4 py-2 rounded font-semibold transition-colors ${
                          settings?.security?.mfaEnabled
                            ? "bg-red-600 hover:bg-red-700"
                            : "bg-green-600 hover:bg-green-700"
                        }`}
                      >
                        {settings?.security?.mfaEnabled ? "Disable" : "Enable"}{" "}
                        MFA
                      </button>
                    </div>
                  </div>
                </div>

                {/* Password Change Section */}
                <div className="bg-gray-800/50 p-6 rounded-lg">
                  <h4 className="font-semibold mb-4">Change Password</h4>
                  <p className="text-sm text-gray-300 mb-4">
                    Password change feature coming soon
                  </p>
                  <button
                    onClick={() =>
                      alert("Password change feature will be available soon!")
                    }
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded transition-colors"
                  >
                    Change Password
                  </button>
                </div>

                {/* Recent Activity Section */}
                <div className="bg-gray-800/50 p-6 rounded-lg">
                  <h4 className="font-semibold mb-4">Recent Activity</h4>
                  <p className="text-sm text-gray-300 mb-4">
                    Your recent account activity and security events
                  </p>

                  {auditLogs.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-600">
                            <th className="text-left py-2 px-2 font-semibold">
                              Action
                            </th>
                            <th className="text-left py-2 px-2 font-semibold">
                              Details
                            </th>
                            <th className="text-left py-2 px-2 font-semibold">
                              Date
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditLogs.slice(0, 10).map((log, index) => (
                            <tr
                              key={log._id || index}
                              className="border-b border-gray-700"
                            >
                              <td className="py-3 px-2">
                                <span className="px-2 py-1 rounded text-xs font-medium bg-blue-600/20 text-blue-300">
                                  {log.action.replace(/_/g, " ").toUpperCase()}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-gray-300">
                                {log.details &&
                                Object.keys(log.details).length > 0
                                  ? Object.entries(log.details)
                                      .map(
                                        ([key, value]) =>
                                          `${key}: ${
                                            typeof value === "object"
                                              ? JSON.stringify(value)
                                              : value
                                          }`
                                      )
                                      .join(", ")
                                  : "No details available"}
                              </td>
                              <td className="py-3 px-2 text-gray-400">
                                {new Date(log.createdAt).toLocaleDateString()}{" "}
                                {new Date(log.createdAt).toLocaleTimeString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {auditLogs.length > 10 && (
                        <p className="text-xs text-gray-500 mt-2">
                          Showing 10 most recent activities. More detailed logs
                          available via admin.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      <div className="text-2xl mb-2">📋</div>
                      <p>No recent activity found</p>
                      <p className="text-xs mt-1">
                        Activity logs will appear here as you use the app
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Preferences Tab */}
            {activeTab === "preferences" && (
              <div className="space-y-6">
                <h3 className="text-xl font-semibold mb-4">⚙️ Preferences</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Notifications */}
                  <div className="bg-gray-800/50 p-6 rounded-lg">
                    <h4 className="font-semibold mb-4">Notifications</h4>
                    <div className="space-y-3">
                      {[
                        {
                          key: "notifications.email",
                          label: "Email Notifications",
                        },
                        {
                          key: "notifications.sms",
                          label: "SMS Notifications",
                        },
                        {
                          key: "notifications.push",
                          label: "Push Notifications",
                        },
                        {
                          key: "notifications.transactionAlerts",
                          label: "Transaction Alerts",
                        },
                        {
                          key: "notifications.securityAlerts",
                          label: "Security Alerts",
                        },
                      ].map(({ key, label }) => (
                        <label
                          key={key}
                          className="flex items-center space-x-3 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={settings[key] || false}
                            onChange={(e) =>
                              handleSettingsUpdate(key, e.target.checked)
                            }
                            className="rounded border-gray-600 text-yellow-400 focus:ring-yellow-400"
                          />
                          <span className="text-sm">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* App Preferences */}
                  <div className="bg-gray-800/50 p-6 rounded-lg">
                    <h4 className="font-semibold mb-4">App Preferences</h4>
                    <div className="space-y-4">
                      <div>
                        <label className="block mb-2 font-semibold">
                          Language
                        </label>
                        <select
                          value={settings.language || "en"}
                          onChange={(e) =>
                            handleSettingsUpdate("language", e.target.value)
                          }
                          className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                        >
                          {languages.map((lang) => (
                            <option key={lang.code} value={lang.code}>
                              {lang.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block mb-2 font-semibold">
                          Currency
                        </label>
                        <select
                          value={settings.currency || "USD"}
                          onChange={(e) =>
                            handleSettingsUpdate("currency", e.target.value)
                          }
                          className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                        >
                          {currencies.map((currency) => (
                            <option key={currency} value={currency}>
                              {currency}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block mb-2 font-semibold">
                          Theme
                        </label>
                        <select
                          value={settings.theme || "dark"}
                          onChange={(e) =>
                            handleSettingsUpdate("theme", e.target.value)
                          }
                          className="w-full p-3 rounded bg-gray-700 border border-gray-600 focus:border-yellow-400 focus:outline-none transition-colors"
                        >
                          <option value="dark">🌙 Dark</option>
                          <option value="light">☀️ Light</option>
                          <option value="auto">🔄 Auto</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Data Tab */}
            {activeTab === "data" && (
              <div className="space-y-6">
                <h3 className="text-xl font-semibold mb-4">
                  📊 Data Management
                </h3>

                {/* Data Export */}
                <div className="bg-gray-800/50 p-6 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold mb-2">Export Your Data</h4>
                      <p className="text-sm text-gray-300">
                        Download a copy of all your VaultBank data in JSON
                        format
                      </p>
                    </div>
                    <button
                      onClick={handleDataExport}
                      className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded hover:from-blue-400 hover:to-purple-500 transition-all duration-300"
                    >
                      📥 Export Data
                    </button>
                  </div>
                </div>

                {/* Account Deletion */}
                <div className="bg-red-900/20 border border-red-500/50 p-6 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h4 className="font-semibold mb-2 text-red-400">
                        Delete Your Account
                      </h4>
                      <p className="text-sm text-gray-300 mb-4">
                        Permanently delete your account and anonymize all your
                        data. This action cannot be undone.
                      </p>

                      <div className="mb-4">
                        <label className="block mb-2 font-semibold">
                          Confirm by typing "DELETE"
                        </label>
                        <input
                          type="text"
                          value={formData.confirmText}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              confirmText: e.target.value,
                            }))
                          }
                          placeholder="Type DELETE to confirm"
                          className="w-full p-3 rounded bg-gray-800 border border-red-500 focus:border-red-400 focus:outline-none transition-colors"
                        />
                      </div>
                    </div>

                    <button
                      onClick={handleAccountDeletion}
                      disabled={formData.confirmText !== "DELETE" || loading}
                      className="ml-4 px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white rounded transition-colors font-semibold"
                    >
                      {loading ? "Deleting..." : "Delete Account"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
