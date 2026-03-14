
import React from 'react';

export default function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center z-50">
      <div className="text-center">
        {/* Animated Logo */}
        <div className="mb-8 animate-luxury-scale-in">
          <div className="w-24 h-24 mx-auto mb-4 relative">
            <div className="absolute inset-0 bg-gradient-to-br from-luxury-gold to-luxury-gold-dark rounded-full animate-luxury-glow-pulse"></div>
            <div className="absolute inset-2 bg-black rounded-full flex items-center justify-center">
              <svg className="w-12 h-12 text-luxury-gold" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                <path fillRule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
          
          {/* Brand Name */}
          <h1 className="text-4xl font-bold text-luxury-gold mb-2 font-playfair">
            VaultBank
          </h1>
          <p className="text-gray-400 text-sm tracking-widest uppercase">
            Luxury Banking Experience
          </p>
        </div>

        {/* Loading Animation */}
        <div className="flex items-center justify-center space-x-2 mb-4">
          <div className="w-3 h-3 bg-luxury-gold rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
          <div className="w-3 h-3 bg-luxury-gold rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
          <div className="w-3 h-3 bg-luxury-gold rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
        </div>

        {/* Loading Text */}
        <p className="text-gray-500 text-sm animate-pulse">
          Loading your luxury experience...
        </p>

        {/* Progress Bar */}
        <div className="mt-8 w-64 mx-auto">
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-luxury-gold to-luxury-gold-light animate-progress-fill"></div>
          </div>
        </div>
      </div>

      {/* Floating Particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-luxury-gold rounded-full opacity-20"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `floatParticle ${5 + Math.random() * 10}s linear infinite`,
              animationDelay: `${Math.random() * 5}s`
            }}
          />
        ))}
      </div>
    </div>
  );
}
