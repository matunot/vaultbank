# Fix AdminDashboard.jsx Unused Variable

## Task

Fix the unused `apiRequest` variable in AdminDashboard.jsx that is causing TypeScript and ESLint warnings.

## Steps

- [ ] Analyze the current code to understand the issue
- [ ] Remove the unused `apiRequest` variable declaration
- [ ] Verify the fix resolves the warnings
- [ ] Test that the component still functions correctly

## Issue Details

- Line 19: `const { apiRequest } = useApi();`
- The `apiRequest` variable is declared but never used
- This causes both TypeScript hint and ESLint warning
