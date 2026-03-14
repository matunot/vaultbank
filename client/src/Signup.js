import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function Signup() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: ''
  });

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Handle signup logic here
    console.log('Signup attempt:', formData);
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
          <h2 className="mt-6 text-4xl font-bold text-white drop-shadow-lg">
            Create your account
          </h2>
          <p className="mt-2 text-lg text-emerald-100 drop-shadow">
            Join VaultBank and start your journey
          </p>
        </div>

        {/* Signup Form */}
        <div className="form-container">
          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* Name Fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-bold text-emerald-800 mb-2 flex items-center">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></span>
                  First name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    required
                    value={formData.firstName}
                    onChange={handleChange}
                    className="input-field block w-full pl-12 pr-4 py-4 border-2 border-emerald-300 rounded-2xl placeholder-emerald-400 text-gray-900 focus:outline-none focus:ring-4 focus:ring-orange-400 focus:border-emerald-500 transition-all duration-300 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-emerald-400"
                    placeholder="John"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-bold text-emerald-800 mb-2 flex items-center">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></span>
                  Last name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    required
                    value={formData.lastName}
                    onChange={handleChange}
                    className="input-field block w-full pl-12 pr-4 py-4 border-2 border-emerald-300 rounded-2xl placeholder-emerald-400 text-gray-900 focus:outline-none focus:ring-4 focus:ring-orange-400 focus:border-emerald-500 transition-all duration-300 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-emerald-400"
                    placeholder="Doe"
                  />
                </div>
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label htmlFor="email" className="block text-sm font-bold text-emerald-800 mb-2 flex items-center">
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
                  value={formData.email}
                  onChange={handleChange}
                  className="input-field block w-full pl-12 pr-4 py-4 border-2 border-emerald-300 rounded-2xl placeholder-emerald-400 text-gray-900 focus:outline-none focus:ring-4 focus:ring-orange-400 focus:border-emerald-500 transition-all duration-300 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-emerald-400"
                  placeholder="Enter your email"
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label htmlFor="password" className="block text-sm font-bold text-emerald-800 mb-2 flex items-center">
                <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></span>
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formData.password}
                  onChange={handleChange}
                  className="input-field block w-full pl-12 pr-4 py-4 border-2 border-emerald-300 rounded-2xl placeholder-emerald-400 text-gray-900 focus:outline-none focus:ring-4 focus:ring-orange-400 focus:border-emerald-500 transition-all duration-300 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-emerald-400"
                  placeholder="Create a password"
                />
              </div>
            </div>

            {/* Confirm Password Field */}
            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-bold text-emerald-800 mb-2 flex items-center">
                <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2"></span>
                Confirm password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className="input-field block w-full pl-12 pr-4 py-4 border-2 border-emerald-300 rounded-2xl placeholder-emerald-400 text-gray-900 focus:outline-none focus:ring-4 focus:ring-orange-400 focus:border-emerald-500 transition-all duration-300 bg-white/80 backdrop-blur-sm hover:bg-white hover:border-emerald-400"
                  placeholder="Confirm your password"
                />
              </div>
            </div>

            {/* Terms and Conditions */}
            <div className="flex items-center">
              <input
                id="terms"
                name="terms"
                type="checkbox"
                required
                className="h-5 w-5 text-cyan-500 focus:ring-cyan-400 border-emerald-300 rounded-lg"
              />
              <label htmlFor="terms" className="ml-2 block text-sm font-semibold text-emerald-700">
                I agree to the{' '}
                <button type="button" className="font-bold text-cyan-600 hover:text-cyan-500 transition-all duration-200 hover:scale-105 bg-orange-200 px-2 py-1 rounded-lg">
                  Terms and Conditions
                </button>
              </label>
            </div>

            {/* Submit Button */}
            <div>
              <button
                type="submit"
                className="submit-button"
              >
                <span className="absolute left-0 inset-y-0 flex items-center pl-4">
                  <svg className="h-6 w-6 text-white group-hover:text-orange-200 animate-spin" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </span>
                🌟 Create account
              </button>
            </div>
          </form>

          {/* Sign in link */}
          <div className="text-center">
            <p className="text-sm font-semibold text-emerald-700">
              Already have an account?{' '}
              <Link to="/login" className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-600 hover:to-emerald-600 transition-all duration-300 hover:scale-105 px-2 py-1 rounded-lg border-2 border-transparent hover:border-orange-300">
                Sign in here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
