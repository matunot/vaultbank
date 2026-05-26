module.exports = {
    // Use jsdom environment for DOM APIs in tests
    testEnvironment: "jsdom",
    // Include the polyfill setup file
    setupFiles: ["<rootDir>/jest.setup.js"],
    // Mock heavy browser libraries that cause import errors in the test environment
    moduleNameMapper: {
        "^jspdf$": "<rootDir>/__mocks__/jspdf.js",
        "^xlsx$": "<rootDir>/__mocks__/xlsx.js",
        "^file-saver$": "<rootDir>/__mocks__/file-saver.js"
    }
};
