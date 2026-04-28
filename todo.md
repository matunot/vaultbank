# TODO: Fix unused apiRequest variable in AdminDashboard.jsx

## Task Breakdown:

- [x] Analyze the TypeScript hint and ESLint warning
- [x] Identify the unused apiRequest variable on line 19
- [x] Remove the unused apiRequest variable from the useApi() destructuring
- [x] Verify the fix by checking the file

## Issue Details:

- Line 19: `const { apiRequest } = useApi();`
- Problem: apiRequest is declared but never used
- Solution: Remove apiRequest from destructuring or remove the entire line if no other properties are needed

## Expected Result:

- [x] TypeScript hint resolved
- [x] ESLint warning resolved
- [x] Component functionality unchanged

## Verification:

The fix has been verified - the AdminDashboard.jsx file no longer contains any `useApi()` import or usage. The component uses localStorage and React hooks directly for admin authentication and state management.
