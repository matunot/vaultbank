export default function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      <div className="text-center">
        {/* Main spinner */}
        <div className="relative mb-8">
          <div className="w-20 h-20 border-4 border-purple-400/30 border-t-purple-400 rounded-full animate-spin mx-auto"></div>
          <div className="absolute inset-0 w-20 h-20 border-4 border-transparent border-r-pink-400 rounded-full animate-spin mx-auto" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>

          {/* Inner pulsing circle */}
          <div className="absolute inset-2 w-16 h-16 bg-gradient-to-r from-purple-400 to-pink-400 rounded-full mx-auto animate-pulse opacity-20"></div>
        </div>

        {/* Loading text */}
        <h2 className="text-2xl font-bold text-white mb-2 animate-pulse">
          Loading VaultBank
        </h2>
        <p className="text-purple-200 animate-pulse">
          Please wait while we prepare your dashboard...
        </p>

        {/* Loading dots */}
        <div className="flex justify-center space-x-2 mt-6">
          <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce"></div>
          <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
          <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
        </div>
      </div>
    </div>
  );
}
