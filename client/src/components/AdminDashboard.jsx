import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { jwtDecode } from "jwt-decode";

// Import admin components
import RewardsAdmin from "./RewardsAdmin";
import AnalyticsDashboard from "./AnalyticsDashboard";
import AutomationDashboard from "./AutomationDashboard";
import SecurityDashboard from "./SecurityDashboard";
import BusinessDashboard from "./BusinessDashboard";
import AuditLog from "./AuditLog";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState("rewards");
  const [adminUser, setAdminUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Check for admin authentication
    const adminToken = localStorage.getItem("adminToken");
    const adminUserData = localStorage.getItem("adminUser");

    if (!adminToken || !adminUserData) {
      navigate("/admin-login");
      return;
    }

    try {
      // Verify token is still valid
      const decoded = jwtDecode(adminToken);
      const currentTime = Date.now() / 1000;

      if (decoded.exp < currentTime) {
        // Token expired, redirect to login
        localStorage.removeItem("adminToken");
        localStorage.removeItem("adminUser");
        navigate("/admin-login");
        return;
      }

      // Parse admin user data
      const userData = JSON.parse(adminUserData);
      setAdminUser(userData);
      setLoading(false);
    } catch (error) {
      console.error("Admin auth verification error:", error);
      navigate("/admin-login");
    }
  }, [navigate]);

  const handleLogout = () => {
    // Clear admin session
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminUser");
    navigate("/admin-login");
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-400 mx-auto"></div>
          <p className="text-green-400 text-lg mt-4">
            Loading Admin Dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (!adminUser) {
    return null; // Will redirect to login
  }

  const tabs = [
    {
      id: "rewards",
      name: "Rewards Admin",
      icon: "🎁",
      component: RewardsAdmin,
    },
    {
      id: "lending",
      name: "Lending Admin",
      icon: "💰",
      component: () => (
        <div className="p-6 text-center">
          <h3 className="text-xl font-semibold text-white mb-4">
            Lending Admin Panel
          </h3>
          <p className="text-gray-400">Manage lending products and services</p>
        </div>
      ),
    },
    {
      id: "insurance",
      name: "Insurance Admin",
      icon: "🛡️",
      component: () => (
        <div className="p-6 text-center">
          <h3 className="text-xl font-semibold text-white mb-4">
            Insurance Admin Panel
          </h3>
          <p className="text-gray-400">Manage insurance products and claims</p>
        </div>
      ),
    },
    {
      id: "fx",
      name: "FX Admin",
      icon: "💱",
      component: () => (
        <div className="p-6 text-center">
          <h3 className="text-xl font-semibold text-white mb-4">
            Foreign Exchange Admin Panel
          </h3>
          <p className="text-gray-400">Manage FX rates and currency services</p>
        </div>
      ),
    },
    {
      id: "business",
      name: "Business Admin",
      icon: "🏢",
      component: BusinessDashboard,
    },
    {
      id: "analytics",
      name: "Analytics",
      icon: "📊",
      component: AnalyticsDashboard,
    },
    {
      id: "automation",
      name: "Automation",
      icon: "⚙️",
      component: AutomationDashboard,
    },
    {
      id: "security",
      name: "Security",
      icon: "🔒",
      component: SecurityDashboard,
    },
    {
      id: "audit",
      name: "Audit Logs",
      icon: "📋",
      component: AuditLog,
    },
  ];

  const ActiveComponent =
    tabs.find((tab) => tab.id === activeTab)?.component || RewardsAdmin;

  return (
    <div className="min-h-screen bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            {/* Logo and Title */}
            <div className="flex items-center">
              <div className="text-2xl font-bold text-white">
                🔐 VaultBank Admin
              </div>
              <div className="ml-4 px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-full">
                {adminUser.role?.toUpperCase() || "ADMIN"}
              </div>
            </div>

            {/* User Info */}
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-white font-medium">
                  {adminUser.name || adminUser.email}
                </div>
                <div className="text-gray-400 text-sm">{adminUser.email}</div>
              </div>
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex space-x-8 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center space-x-2 py-4 px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? "border-green-400 text-green-400"
                    : "border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-300"
                }`}
              >
                <span className="text-lg">{tab.icon}</span>
                <span>{tab.name}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Active Tab Indicator */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-white flex items-center">
              <span className="mr-3 text-2xl">
                {tabs.find((tab) => tab.id === activeTab)?.icon}
              </span>
              {tabs.find((tab) => tab.id === activeTab)?.name}
            </h2>
            <div className="mt-2 h-1 bg-gradient-to-r from-green-400 to-blue-500 rounded"></div>
          </div>

          {/* Active Component */}
          <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700">
            <ActiveComponent />
          </div>
        </div>
      </main>

      {/* Security Notice */}
      <footer className="bg-gray-800 border-t border-gray-700 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="text-center">
            <p className="text-xs text-gray-500">
              🔒 All admin actions are monitored and logged. Session timeout: 7
              days
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
