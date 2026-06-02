// Stub for react-refresh/babel used in production builds.
// react-scripts@5 registers this plugin in dev for HMR, but it crashes
// when NODE_ENV is production. Aliasing it to a no-op is safe in prod.
module.exports = function () {
    return {
        name: 'react-refresh-stub',
        visitor: {},
    };
};
