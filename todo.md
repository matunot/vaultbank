# TODO: Fix unused apiRequest variable in AdminDashboard.jsx

## Task Breakdown:

- [x] Analyze the TypeScript hint and ESLint warning
- [x] Identify the unused apiRequest variable on line 19
- [ ] Remove the unused apiRequest variable from the useApi() destructuring
- [ ] Verify the fix by checking the file

## Issue Details:

- Line 19: `const { apiRequest } = useApi();`
- Problem: apiRequest is declared but never used
- Solution: Remove apiRequest from destructuring or remove the entire line if no other properties are needed

## Expected Result:

- TypeScript hint resolved
- ESLint warning resolved
- Component functionality unchanged
