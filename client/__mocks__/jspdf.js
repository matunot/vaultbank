// Mock implementation of jsPDF for Jest tests
// Provides a minimal stub of the jsPDF constructor with common methods.
class jsPDF {
    // Stub methods that are typically used in the codebase.
    save() { }
    text() { }
    addImage() { }
    setFontSize() { }
}

module.exports = jsPDF;
