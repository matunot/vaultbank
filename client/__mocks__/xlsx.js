// Mock implementation of the 'xlsx' library for Jest tests.
// Provides minimal stubs for the API used in the application.
module.exports = {
    // read returns a workbook-like object with empty sheets.
    read: () => ({ SheetNames: [], Sheets: {} }),
    utils: {
        // sheet_to_json returns an empty array by default.
        sheet_to_json: () => []
    },
    // writeFile is a no‑op in the mock.
    writeFile: () => { }
};
