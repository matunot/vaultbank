import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../config/apiConfig';

/**
 * Simplified signup component for progressive onboarding.
 * It collects only an email address, calls the new /api/auth/register endpoint
 * which sends a magic‑link to the user, and displays success/error messages.
 */
export default function Signup() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState(''); // 'success' or 'error'

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      const response = await api.post('/api/auth/register', { email });
      if (response.success) {
        setMessageType('success');
        setMessage('Magic link sent! Please check your email to complete registration.');
      } else {
        setMessageType('error');
        setMessage(response.message || 'Failed to send magic link.');
      }
    } catch (err) {
      console.error('Signup error:', err);
      setMessageType('error');
      setMessage('An error occurred while sending the magic link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute top-0 left-0 w-full h-full animated-bg">
        <div className="absolute top-10 left-10 w-32 h-32 bg-orange-300 rounded-full opacity-20 pulse-circle"></div>
        <div className="absolute top-20 right-20 w-24 h-24 bg-pink-300 rounded-full opacity-30 bounce-circle"></div>
        <div className="absolute bottom-20 left-20 w-20 h-20 bg-yellow-300 rounded-full opacity-25 pulse-circle"></div>
        <div className="absolute bottom-10 right-10 w-28 h-28 bg-purple-300 rounded-full opacity-20 bounce-circle"></div>
      </div>

      <div className="max-w-md w-full space-y-8 relative z-10">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto h-20 w-20 rounded-3xl flex items-center justify-center shadow-2xl transform -rotate-3 hover:rotate-0 transition-transform duration-300" style={{ background: 'linear-gradient(135deg, #10b981 0%, #22c55e 50%, #14b8a6 100%)' }}>
            <svg className="h-10 w-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <h2 className="mt-6 text-4xl font-bold text-white drop-shadow-lg">Create your account</h2>
          <p className="mt-2 text-lg text-emerald-100 drop-shadow">Enter your email to receive a magic‑link</p>
        </div>

        {/* Form */}
        <form className="space-y-6" onSubmit={handleSubmit}>
          {/* Email Field */}
          <div>
            <label htmlFor="email" className="text-sm font-bold text-emerald-800 mb-2 flex items-center">
              <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></span>
              Email address
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
              </div>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field block w-full pl-12 pr-4 py-4 border-2 border-emerald-300 rounded-2xl placeholder-emerald-400 text-gray-900 focus:outline-none focus:ring-4 focus:ring-orange-400 focus:border-emerald-500 transition-all duration-300 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-emerald-400"
                placeholder="Enter your email"
              />
            </div>
          </div>

          {/* Message */}
          {message && (
            <div className={`p-3 rounded-lg text-center font-semibold text-sm ${messageType === 'success' ? 'bg-green-900/50 text-green-300 border border-green-700' : 'bg-red-900/50 text-red-300 border border-red-700'}`}>
              {message}
            </div>
          )}

          {/* Submit Button */}
          <div>
            <button
              type="submit"
              disabled={loading}
              className={`submit-button ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {loading ? 'Sending...' : '🚀 Send Magic Link'}
            </button>
          </div>
        </form>

        {/* Sign in link */}
        <div className="text-center mt-4">
          <p className="text-sm font-semibold text-emerald-700">
            Already have an account?{' '}
            <Link to="/login" className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600 transition-all duration-300 hover:scale-105 px-2 py-1 rounded-lg border-2 border-transparent hover:border-orange-300">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
