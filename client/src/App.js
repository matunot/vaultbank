import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './index.css';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './Login';
import Dashboard from './Dashboard';
import Pricing from './components/Pricing';
import SecurityDashboard from './components/SecurityDashboard';
import AdminCommandCenter from './components/AdminCommandCenter';
import LoadingScreen from './components/LoadingScreen';
import NotificationContainer, { ToastProvider } from './components/NotificationContainer';
import ParticleBackground from './components/ParticleBackground';
import ReportsDashboard from './components/ReportsDashboard';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import WealthDashboard from './components/WealthDashboard';
import AssistantWidget from './components/AssistantWidget';

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [user, setUser] = useState(null);
  const [darkMode, setDarkMode] = useState(true);
  const [lastActive, setLastActive] = useState(Date.now());
  const [subscription, setSubscription] = useState("trial");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const trialEnds = useMemo(() => Date.now() + 3 * 24 * 60 * 60 * 1000, []);

  // Session timeout logic with proper cleanup
  const resetTimer = useCallback(() => setLastActive(Date.now()), []);
  const sessionTimeoutRef = React.useRef(null);
  const sessionIntervalRef = React.useRef(null);

  // Logout function must be defined before use in useEffect
  const handleLogout = useCallback(() => {
    setVerified(false);
    setUser(null);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    window.location.href = '/';
  }, []);

  useEffect(() => {
    // Add event listeners
    const handleActivity = () => resetTimer();

    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("click", handleActivity);
    window.addEventListener("scroll", handleActivity);

    // Set up session timeout check
    sessionIntervalRef.current = setInterval(() => {
      if (Date.now() - lastActive > 5 * 60 * 60 * 1000) { // 5 minutes
        alert("Session expired. Please log in again.");
        handleLogout();
      }
    }, 60000);

    // Capture current ref values for cleanup
    const currentSessionTimeoutRef = sessionTimeoutRef.current;
    const currentSessionIntervalRef = sessionIntervalRef.current;

    // Cleanup function
    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("scroll", handleActivity);

      if (currentSessionIntervalRef) {
        clearInterval(currentSessionIntervalRef);
      }

      if (currentSessionTimeoutRef) {
        clearTimeout(currentSessionTimeoutRef);
      }
    };
  }, [resetTimer, lastActive, handleLogout]);

  // Premium trial check with proper dependency management
  useEffect(() => {
    if (subscription === "trial" && trialEnds && Date.now() > trialEnds) {
      setSubscription("free");
      alert("⏳ Your Premium Trial has ended...");
    }
  }, [subscription, trialEnds]);

  const handleLogin = useCallback((userData) => {
    setUser(userData);
    setVerified(true);
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', userData.token);
  }, []);

  // Set loading to false after component mounts
  useEffect(() => {
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <ToastProvider>
      <Router>
        <div className={darkMode ? "bg-gray-900 text-white min-h-screen" : "bg-gray-100 text-black min-h-screen"}>
          <div className="absolute top-4 right-4 z-50">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${darkMode
                ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                : "bg-indigo-500 hover:bg-indigo-600 text-white"}`}
            >
              {darkMode ? "Light Mode" : "Dark Mode"}
            </button>
          </div>

          {darkMode && <ParticleBackground />}
          <NotificationContainer />
          <AssistantWidget user={user} isAuthenticated={verified} />

          <Routes>
            <Route
              path="/"
              element={verified ? (
                <Dashboard darkMode={darkMode} subscription={subscription} setSubscription={setSubscription} />
              ) : (
                <Login onVerify={handleLogin} />
              )}
            />
            <Route
              path="/pricing"
              element={
                <Pricing
                  user={user}
                  showUpgradeModal={showUpgradeModal}
                  setShowUpgradeModal={setShowUpgradeModal}
                />
              }
            />
            <Route
              path="/security"
              element={
                <SecurityDashboard
                  user={user}
                  onAdminSearch={() => { }}
                />
              }
            />
            <Route
              path="/admin"
              element={
                <AdminCommandCenter
                  user={user}
                />
              }
            />
            <Route
              path="/reports"
              element={<ReportsDashboard user={user} />}
            />
            <Route
              path="/analytics"
              element={<AnalyticsDashboard user={user} />}
            />
            <Route
              path="/wealth"
              element={<WealthDashboard darkMode={darkMode} />}
            />
          </Routes>
        </div>
      </Router>
    </ToastProvider>
  );
}

export default App;
