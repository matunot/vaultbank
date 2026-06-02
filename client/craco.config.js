// eslint-disable-next-line no-unused-vars
const path = require('path');

module.exports = {
  style: {
    postcss: {
      mode: 'extends',
      plugins: [
        require('@tailwindcss/postcss'),
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
                        require('@tailwindcss/postcss'),
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

      // Stub out ajv-keywords' _formatLimit keyword AND the react-refresh
      // babel plugin in production. Both are loaded transitively and crash
      // when NODE_ENV=production. Aliasing them to no-op stubs lets the
      // build proceed.
      const isProd = process.env.NODE_ENV === 'production' || process.env.CI;
      const stubDir = path.resolve(__dirname, 'scripts');
      const ajvStub = path.join(stubDir, 'ajv-keywords-stub.js');
      const refreshStub = path.join(stubDir, 'react-refresh-stub.js');

      const existingAlias = webpackConfig.resolve && webpackConfig.resolve.alias;
      const aliasPatch = {
        'ajv-keywords/dist/keywords/_formatLimit': ajvStub,
      };
      if (isProd) {
        aliasPatch['react-refresh/babel'] = refreshStub;
      }
      if (existingAlias && typeof existingAlias === 'object') {
        if (Array.isArray(existingAlias)) {
          existingAlias.push(aliasPatch);
        } else {
          Object.assign(existingAlias, aliasPatch);
        }
      } else {
        webpackConfig.resolve = webpackConfig.resolve || {};
        webpackConfig.resolve.alias = aliasPatch;
      }

      return webpackConfig;
    },
  },
};
