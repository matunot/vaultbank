import React, { useState, useRef } from 'react';

export default function Login({ onVerify }) {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [twoFA, setTwoFA] = useState('');
  const [verified, setVerified] = useState(false);
  const [mfaAttempts, setMfaAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const cooldownIntervalRef = useRef(null);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    // Clear any existing messages when interacting with inputs
    setMessage('');
    setMessageType('');
  };

  const handleInputFocus = () => {
    // Ensure messages are cleared when focusing on inputs
    setMessage('');
    setMessageType('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    // Demo mode: Always succeed for any email/password
    setTimeout(() => {
      setMessageType('success');
      setLoading(false);
    }, 1000); // Simulate network delay
  };

  const handleVerify = () => {
    // Check if in cooldown period
    if (cooldown > 0) {
      setMessageType('error');
      setMessage(`Too many attempts. Please wait ${cooldown} seconds before trying again.`);
      return;
    }

    if (twoFA === "123456") { // Demo code
      setVerified(true);
      setMfaAttempts(0);
      setCooldown(0);
      // Now proceed with login
      const token = "demo-token"; // In real app, this would come from server
      localStorage.setItem("token", token);
      const userData = { email: formData.email, token: token };
      localStorage.setItem("user", JSON.stringify(userData));
      setMessageType('success');
      setMessage('✔️ Login successful! Redirecting...');
      // Call onVerify with user data
      if (onVerify) {
        onVerify(userData);
      }
    } else {
      const newAttempts = mfaAttempts + 1;
      setMfaAttempts(newAttempts);
      setTwoFA("");

      if (newAttempts >= 3) {
        setCooldown(30); // 30 second cooldown after 3 failed attempts
        setMfaAttempts(0);

        // Countdown timer with proper cleanup
        if (cooldownIntervalRef.current) {
          clearInterval(cooldownIntervalRef.current);
        }
        cooldownIntervalRef.current = setInterval(() => {
          setCooldown(prev => {
            if (prev <= 1) {
              if (cooldownIntervalRef.current) {
                clearInterval(cooldownIntervalRef.current);
                cooldownIntervalRef.current = null;
              }
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        setMessageType('error');
        setMessage("Too many failed attempts. Please wait 30 seconds before trying again.");
      } else {
        setMessageType('error');
        setMessage(`Invalid code. ${3 - newAttempts} attempts remaining.`);
      }
    }
  };

  // If verified, don't show anything (dashboard will load)
  // If not verified and we have a successful login attempt, show 2FA
  // Otherwise show regular login form
  if (verified) {
    return null; // Dashboard will be rendered by App component
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center" style={{ background: '#000000' }}>
      <div className="flex items-center justify-center w-full h-full">
        <div className="form">
          {/* Header */}
          <div id="heading">
            <p className="text-gray-400 text-sm">
              {messageType === 'success' ? 'Enter 2FA Code' : 'Sign in to your account'}
            </p>
          </div>

          {/* Success/Error Message */}
          {/* Message container - will only render when message exists */}
          <div className={`mb-4 p-3 rounded-lg text-center font-semibold text-sm 
            ${messageType === 'success' ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-red-900/50 text-red-300 border border-red-700'}
            transition-opacity duration-200
            ${message && messageType !== 'success' ? 'opacity-100' : 'opacity-0 h-0 p-0 border-0'}`}>
            {message}
          </div>

          {/* Show 2FA if login was successful */}
          {messageType === 'success' ? (
            <div>
              <div className="mb-4 p-3 rounded-lg text-center text-sm bg-blue-900/50 text-blue-300 border border-blue-700">
                Check your email/app for the verification code.
              </div>
              <div className="field">
                <input
                  type="text"
                  value={twoFA}
                  onChange={(e) => setTwoFA(e.target.value)}
                  className="input-field text-center"
                  placeholder="Enter 6-digit code (demo: 123456)"
                  maxLength="6"
                />
              </div>
              <div className="btn">
                <button
                  onClick={handleVerify}
                  className="button1 w-full"
                >
                  🔐 Verify Code
                </button>
              </div>
              <div className="text-center mt-4">
                <button
                  onClick={() => {
                    setMessage('');
                    setMessageType('');
                  }}
                  className="text-sm text-purple-400 hover:text-purple-300"
                >
                  Back to login
                </button>
              </div>
            </div>
          ) : (
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
                  onFocus={handleInputFocus}
                  className="input-field"
                  placeholder="Email Address"
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
                  onFocus={handleInputFocus}
                  className="input-field"
                  placeholder="Password"
                />
              </div>

              {/* Remember me and Forgot password */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="w-4 h-4 text-purple-600 bg-gray-800 border-2 border-gray-600 rounded focus:ring-purple-500"
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm font-medium text-gray-300">
                    Remember me
                  </label>
                </div>
                <div className="text-sm">
                  <button type="button" className="font-medium text-purple-400 hover:text-purple-300 transition-colors duration-200">
                    Forgot password?
                  </button>
                </div>
              </div>

              {/* Buttons Container */}
              <div className="btn">
                <button
                  type="submit"
                  disabled={loading}
                  className={`button1 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {loading ? 'Signing in...' : '🚀 Sign In'}
                </button>
                <button type="button" className="button2">
                  Sign Up
                </button>
              </div>

              {/* Sign up message */}
              <div className="text-center mt-4">
                <p className="text-sm text-gray-400">
                  Don't have an account?{' '}
                  <span className="font-semibold text-purple-400">
                    Signup coming soon! (demo only)
                  </span>
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
