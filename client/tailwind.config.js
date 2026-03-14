const plugin = require('tailwindcss/plugin');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'luxury-gold': '#D4AF37',
        'luxury-gold-dark': '#B8941E',
        'luxury-gold-light': '#F4D03F',
      },
      fontFamily: {
        'playfair': ['"Playfair Display"', 'serif'],
      },
      rotate: {
        180: '180deg',
      },
      keyframes: {
        glow: {
          '0%, 100%': { boxShadow: '0 0 0px rgba(255,215,0,0.0)' },
          '50%': { boxShadow: '0 0 24px rgba(255,215,0,0.35)' },
        },
        slideInRight: {
          '0%': {
            opacity: '0',
            transform: 'translateX(30px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateX(0)',
          },
        },
        pulse: {
          '0%, 100%': {
            opacity: '1',
          },
          '50%': {
            opacity: '0.5',
          },
        },
      },
      animation: {
        'slide-in-right': 'slideInRight 0.3s ease-out forwards',
        'pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 3s ease-in-out infinite',
      },
    },
  },
  plugins: [
    plugin(function ({ addUtilities }) {
      addUtilities({
        '.perspective': { perspective: '1000px' },
        '.preserve-3d': { transformStyle: 'preserve-3d' },
        '.backface-hidden': { backfaceVisibility: 'hidden' },
        '.rotate-y-180': { transform: 'rotateY(180deg)' },
      });
    }),
  ],
}
