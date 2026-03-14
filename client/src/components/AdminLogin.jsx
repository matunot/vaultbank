import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../utils/api";

export default function AdminLogin({ onAdminLogin }) {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { apiRequest } = useApi();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
    if (error) setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(formData),
        showToast: false,
      });

      if (response.success && response.token) {
        // Check if user has admin role
        const userRole = response.user?.role;
        if (userRole === "super_admin" || userRole === "admin") {
          setSuccess(true);

          // Store admin session data
          const adminData = {
            ...response.user,
            token: response.token,
            isAdmin: true,
          };

          localStorage.setItem("adminToken", response.token);
          localStorage.setItem("adminUser", JSON.stringify(adminData));

          // Notify parent component
          if (onAdminLogin) {
            onAdminLogin(adminData);
          }

          // Navigate to admin dashboard
          setTimeout(() => {
            navigate("/admin-dashboard");
          }, 1000);
        } else {
          setError("Access denied. Admin credentials required.");
        }
      } else {
        setError(response.message || "Login failed");
      }
    } catch (error) {
      console.error("Admin login error:", error);
      setError("Network error. Please check if the server is running.");
    } finally {
      setLoading(false);
    }
  };

  // Auto-fill demo credentials
  const fillDemoCredentials = () => {
    setFormData({
      email: "admin@vaultbank.com",
      password: "admin123",
    });
  };

  if (success) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center"
        style={{ background: "#000000" }}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-400 mx-auto"></div>
          <p className="text-green-400 text-lg mt-4">Admin login successful!</p>
          <p className="text-gray-400 text-sm mt-2">
            Redirecting to Admin Dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ background: "#000000" }}
    >
      <div className="flex items-center justify-center w-full h-full">
        <div className="form max-w-md">
          {/* Header */}
          <div id="heading">
            <h2 className="text-2xl font-bold mb-2">🔐 VaultBank Admin</h2>
            <p className="text-gray-400 text-sm">Sign in to admin dashboard</p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 rounded-lg text-center font-semibold text-sm bg-red-900/50 text-red-300 border border-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Email Field */}
            <div className="field">
              <svg className="input-icon" viewBox="0 0 24 24">
                <path d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
              </svg>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={handleChange}
                className="input-field"
                placeholder="Admin Email Address"
              />
            </div>

            {/* Password Field */}
            <div className="field">
              <svg className="input-icon" viewBox="0 0 24 24">
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={formData.password}
                onChange={handleChange}
                className="input-field"
                placeholder="Admin Password"
              />
            </div>

            {/* Demo Credentials Helper */}
            <div className="text-center mb-4">
              <button
                type="button"
                onClick={fillDemoCredentials}
                className="text-sm text-blue-400 hover:text-blue-300 underline"
              >
                Use demo credentials (admin@vaultbank.com)
              </button>
            </div>

            {/* Buttons Container */}
            <div className="btn">
              <button
                type="submit"
                disabled={loading}
                className={`button1 w-full ${
                  loading ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                {loading ? "Signing in..." : "🚀 Admin Sign In"}
              </button>
              <button
                type="button"
                className="button2"
                onClick={() => navigate("/")}
              >
                Back to User Login
              </button>
            </div>

            {/* Security Notice */}
            <div className="text-center mt-4">
              <p className="text-xs text-gray-500">
                🔒 Admin access is restricted and monitored. All activities are
                logged.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
