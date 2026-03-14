import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

export default function LuxurySidebar() {
    const location = useLocation();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [user, setUser] = useState(null);

    useEffect(() => {
        const userData = localStorage.getItem('user');
        if (userData) {
            try {
                setUser(JSON.parse(userData));
            } catch (e) {
                console.error('Failed to parse user data:', e);
            }
        }
    }, []);

    const isActive = (path) => {
        return location.pathname === path;
    };

    const menuItems = [
        { path: '/dashboard', icon: '🏠', label: 'Dashboard', premium: false },
        { path: '/wealth', icon: '💰', label: 'Wealth', premium: true },
        { path: '/security', icon: '🛡️', label: 'Security', premium: false },
        { path: '/analytics', icon: '📊', label: 'Analytics', premium: true },
        { path: '/reports', icon: '📑', label: 'Reports', premium: true },
        { path: '/settings', icon: '⚙️', label: 'Settings', premium: false },
        { path: '/help', icon: '❓', label: 'Help', premium: false },
    ];

    const adminItems = [
        { path: '/admin', icon: '🚨', label: 'Admin', premium: false },
    ];

    const isUserAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

    return (
        <>
            {/* Mobile Toggle Button */}
            <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="md:hidden fixed top-20 left-4 z-50 luxury-button p-3 rounded-lg shadow-luxury-md"
            >
                {isCollapsed ? '☰' : '✕'}
            </button>

            {/* Sidebar */}
            <aside className={`luxury-sidebar fixed left-0 top-16 h-full w-20 md:w-64 transition-all duration-300 ease-in-out z-40 ${isCollapsed ? '-translate-x-full md:translate-x-0 md:w-20' : 'translate-x-0'
                }`}>
                {/* Logo Section */}
                <div className="p-4 border-b border-yellow-400/20">
                    <div className="flex items-center justify-center md:justify-start space-x-3">
                        <div className="h-12 w-12 bg-gradient-to-br from-yellow-400 via-yellow-500 to-yellow-600 rounded-2xl flex items-center justify-center shadow-2xl border border-yellow-300/50">
                            <svg className="h-7 w-7 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        {!isCollapsed && (
                            <div className="hidden md:block">
                                <h1 className="text-xl font-bold luxury-heading">VaultBank</h1>
                                <p className="text-xs text-luxury-gold luxury-subheading">Premium</p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Navigation Menu */}
                <nav className="p-4 space-y-2">
                    {menuItems.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`group flex items-center space-x-3 p-3 rounded-lg transition-all duration-300 ${isActive(item.path)
                                    ? 'bg-yellow-400/10 border border-yellow-400/30 text-yellow-400'
                                    : 'text-gray-300 hover:text-yellow-400 hover:bg-yellow-400/5 border border-transparent'
                                }`}
                        >
                            <span className="text-2xl group-hover:scale-110 transition-transform duration-300">
                                {item.icon}
                            </span>
                            {!isCollapsed && (
                                <div className="flex-1 flex justify-between items-center">
                                    <span className="font-semibold">{item.label}</span>
                                    {item.premium && (
                                        <span className="text-xs bg-yellow-400/20 text-yellow-400 px-2 py-1 rounded-full border border-yellow-400/30">
                                            PREMIUM
                                        </span>
                                    )}
                                </div>
                            )}
                        </Link>
                    ))}
                </nav>

                {/* Admin Section */}
                {isUserAdmin && (
                    <>
                        <div className="border-t border-yellow-400/20 my-4"></div>
                        <div className="p-4">
                            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Administration</p>
                            {adminItems.map((item) => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`group flex items-center space-x-3 p-3 rounded-lg transition-all duration-300 ${isActive(item.path)
                                            ? 'bg-red-400/10 border border-red-400/30 text-red-400'
                                            : 'text-gray-300 hover:text-red-400 hover:bg-red-400/5 border border-transparent'
                                        }`}
                                >
                                    <span className="text-2xl group-hover:scale-110 transition-transform duration-300">
                                        {item.icon}
                                    </span>
                                    {!isCollapsed && (
                                        <div className="flex-1 flex justify-between items-center">
                                            <span className="font-semibold">{item.label}</span>
                                        </div>
                                    )}
                                </Link>
                            ))}
                        </div>
                    </>
                )}

                {/* User Info Section */}
                <div className="absolute bottom-6 left-4 right-4">
                    <div className="border-t border-yellow-400/20 pt-4">
                        {user ? (
                            <div className="flex items-center space-x-3">
                                <div className="h-10 w-10 luxury-avatar rounded-full overflow-hidden border-2 border-yellow-400/50">
                                    <img
                                        src={user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.email)}&background=4f46e5&color=fff`}
                                        alt="avatar"
                                        className="h-full w-full object-cover"
                                    />
                                </div>
                                {!isCollapsed && (
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-white truncate">{user.name || user.email}</p>
                                        <p className="text-xs text-gray-400">{user.role || 'User'}</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-center">
                                <p className="text-sm text-gray-400">Not logged in</p>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {/* Overlay for mobile */}
            {isCollapsed && (
                <div
                    className="md:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-30"
                    onClick={() => setIsCollapsed(false)}
                ></div>
            )}
        </>
    );
}
