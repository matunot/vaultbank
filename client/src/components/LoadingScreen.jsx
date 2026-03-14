import React from "react";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-black via-gray-900 to-black">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <h2 className="text-2xl font-bold text-yellow-400 mb-2">VaultBank</h2>
        <p className="text-yellow-300/70">
          Loading your premium banking experience...
        </p>
      </div>
    </div>
  );
}

export default LoadingScreen;
