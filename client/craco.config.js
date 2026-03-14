const path = require('path');

module.exports = {
  style: {
    postcss: {
      mode: 'extends',
      plugins: [
        require('tailwindcss'),
        require('autoprefixer'),
      ],
    },
  },
  webpack: {
    configure: (webpackConfig) => {
      // Ensure CSS is processed correctly
      const cssRule = webpackConfig.module.rules.find(
        (rule) => rule.oneOf
      );
      
      if (cssRule) {
        cssRule.oneOf.forEach((rule) => {
          if (rule.test && rule.test.toString().includes('css')) {
            if (rule.use) {
              rule.use.forEach((loader) => {
                if (loader.loader && loader.loader.includes('postcss-loader')) {
                  loader.options = {
                    ...loader.options,
                    postcssOptions: {
                      plugins: [
                        require('tailwindcss'),
                        require('autoprefixer'),
                      ],
                    },
                  };
                }
              });
            }
          }
        });
      }
      
      return webpackConfig;
    },
  },
};
