import { Link, useLocation } from 'react-router-dom';

export default function Navigation() {
  const location = useLocation();

  const isActive = (path) => {
    return location.pathname === path;
  };

  return (
    <nav className="luxury-nav fixed top-0 left-0 right-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-3 group">
              <div className="h-12 w-12 bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 rounded-2xl flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform duration-300 border border-yellow-300/50">
                <svg className="h-7 w-7 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold luxury-heading tracking-tight">VaultBank</h1>
                <p className="text-xs text-luxury-gold luxury-subheading opacity-0 group-hover:opacity-100 transition-opacity duration-300">Premium Banking</p>
              </div>
            </Link>
          </div>

          {/* Wealth Dashboard Link for Authenticated Users */}
          {localStorage.getItem('token') && (
            <div className="hidden md:flex items-center space-x-2">
              <Link
                to="/wealth"
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center space-x-2 ${location.pathname === '/wealth'
                  ? 'text-yellow-400 bg-yellow-400/10 border border-yellow-400/30'
                  : 'text-gray-300 hover:text-yellow-400 hover:bg-yellow-400/5 border border-transparent'
                  }`}
              >
                <span className="text-lg">💰</span>
                <span>Wealth</span>
              </Link>
              <Link
                to="/security"
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center space-x-2 ${location.pathname === '/security'
                  ? 'text-blue-400 bg-blue-400/10 border border-blue-400/30'
                  : 'text-gray-300 hover:text-blue-400 hover:bg-blue-400/5 border border-transparent'
                  }`}
              >
                <span className="text-lg">🛡️</span>
                <span>Security</span>
              </Link>
              <Link
                to="/analytics"
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center space-x-2 ${location.pathname === '/analytics'
                  ? 'text-green-400 bg-green-400/10 border border-green-400/30'
                  : 'text-gray-300 hover:text-green-400 hover:bg-green-400/5 border border-transparent'
                  }`}
              >
                <span className="text-lg">📊</span>
                <span>Analytics</span>
              </Link>
              {/* Admin Command Center Link for Admin Users */}
              {(() => {
                try {
                  const userData = JSON.parse(localStorage.getItem('user') || '{}');
                  return (userData.role === 'admin' || userData.role === 'super_admin') && (
                    <>
                      <Link
                        to="/admin"
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center space-x-2 ${location.pathname === '/admin'
                          ? 'text-red-400 bg-red-400/10 border border-red-400/30'
                          : 'text-gray-300 hover:text-red-400 hover:bg-red-400/5 border border-transparent'
                          }`}
                      >
                        <span className="text-lg">🚨</span>
                        <span>Admin</span>
                      </Link>
                      <Link
                        to="/reports"
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 flex items-center space-x-2 ${location.pathname === '/reports'
                          ? 'text-purple-400 bg-purple-400/10 border border-purple-400/30'
                          : 'text-gray-300 hover:text-purple-400 hover:bg-purple-400/5 border border-transparent'
                          }`}
                      >
                        <span className="text-lg">📊</span>
                        <span>Reports</span>
                      </Link>
                    </>
                  );
                } catch {
                  return null;
                }
              })()}
            </div>
          )}

          {/* Navigation Links */}
          <div className="flex items-center space-x-4">
            <Link
              to="/login"
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${isActive('/login')
                ? 'text-yellow-400 bg-yellow-400/10 border border-yellow-400/30'
                : 'text-gray-300 hover:text-yellow-400 hover:bg-yellow-400/5 border border-transparent'
                }`}
            >
              Login
            </Link>
            <Link
              to="/signup"
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-300 ${isActive('/signup')
                ? 'text-yellow-400 bg-yellow-400/10 border border-yellow-400/30'
                : 'text-gray-300 hover:text-yellow-400 hover:bg-yellow-400/5 border border-transparent'
                }`}
            >
              Sign Up
            </Link>
            <Link
              to="/dashboard"
              className={`luxury-button px-6 py-3 text-sm font-bold transition-all duration-300 ${isActive('/dashboard')
                ? 'scale-105 shadow-luxury-lg'
                : 'hover:scale-105 shadow-luxury-md'
                }`}
            >
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
