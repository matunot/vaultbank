import { Link, useLocation } from "react-router-dom";

export default function Navigation() {
  const location = useLocation();

  const isActive = (path) => {
    return location.pathname === path;
  };

  const navItems = [
    { path: "/dashboard", icon: "🏠", label: "Dashboard" },
    { path: "/wealth", icon: "💰", label: "Wealth", feature: "pro" },
    { path: "/business", icon: "🏢", label: "Business", feature: "business" },
    // Future modules can be added here
  ];

  const userData = JSON.parse(localStorage.getItem("user") || "{}");
  const hasPermission = (feature) => {
    // Check subscription tier and feature access
    const tier = userData.tier || "free";
    const planFeatures = {
      free: ["dashboard", "transfers", "analytics"],
      pro: ["dashboard", "transfers", "analytics", "wealth"],
      business: ["dashboard", "transfers", "analytics", "wealth", "business"],
    };
    return planFeatures[tier]?.includes(feature);
  };

  const isAdmin = userData.role === "admin" || userData.role === "super_admin";

  return (
    <nav className="bg-gradient-to-r from-blue-600 to-purple-600 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/dashboard" className="flex items-center space-x-2">
              <div className="h-10 w-10 bg-white rounded-xl flex items-center justify-center shadow-lg">
                <svg
                  className="h-6 w-6 text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <div>
                <span className="text-xl font-bold text-white">VaultBank</span>
                <div className="text-xs text-blue-100 uppercase tracking-wider">
                  {userData.tier || "free"} Plan
                </div>
              </div>
            </Link>
          </div>

          {/* Authenticated Navigation */}
          {localStorage.getItem("token") && (
            <div className="hidden md:flex items-center space-x-6">
              {/* Main Navigation */}
              {navItems.map(
                (item) =>
                  (!item.feature || hasPermission(item.feature)) && (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                        isActive(item.path)
                          ? "bg-white/20 text-white shadow-lg backdrop-blur-sm"
                          : "text-blue-100 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  )
              )}

              {/* Admin Panel */}
              {isAdmin && (
                <Link
                  to="/admin"
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                    location.pathname === "/admin"
                      ? "bg-red-500/20 text-white shadow-lg backdrop-blur-sm"
                      : "text-red-200 hover:text-white hover:bg-red-500/10"
                  }`}
                >
                  <span>🚨</span>
                  <span>Admin</span>
                </Link>
              )}

              {/* User Menu */}
              <div className="flex items-center space-x-3 ml-6 border-l border-blue-400 pl-6">
                <Link
                  to="/settings"
                  className="text-blue-100 hover:text-white transition-colors"
                >
                  <svg
                    className="h-6 w-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </Link>

                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to sign out?")) {
                      localStorage.clear();
                      window.location.href = "/login";
                    }
                  }}
                  className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition-all duration-200"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}

          {/* Mobile Sign In/Up */}
          {!localStorage.getItem("token") && (
            <div className="flex items-center space-x-8">
              <Link
                to="/login"
                className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                  isActive("/login")
                    ? "text-blue-200 bg-white/20 backdrop-blur-sm"
                    : "text-blue-100 hover:text-white hover:bg-white/10"
                }`}
              >
                Sign In
              </Link>
              <Link
                to="/pricing"
                className="bg-white text-blue-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-50 transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Get Started
              </Link>
            </div>
          )}

          {/* Mobile Menu Button */}
          <div className="md:hidden">
            <button className="text-white hover:text-blue-200 p-2">
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
