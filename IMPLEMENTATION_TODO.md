# Admin Login & Dashboard Access Implementation

## Task Overview

Implement comprehensive admin authentication and dashboard access for VaultBank using Supabase Auth.

## Implementation Steps

- [ ] Analyze existing authentication setup
- [ ] Set up Supabase Auth integration
- [ ] Create admin login backend endpoint (/api/auth/login)
- [ ] Implement JWT middleware for admin route protection
- [ ] Create AdminLogin.jsx component
- [ ] Create AdminDashboard.jsx component with tabs
- [ ] Implement role-based access control
- [ ] Add audit logging for admin actions
- [ ] Test admin login flow
- [ ] Test role-based access restrictions
- [ ] Test admin functionality updates

## Technical Requirements

- Use Supabase Auth for authentication
- Support admin credentials: admin@vaultbank.com / admin123
- Role field check: "super_admin" or "admin"
- JWT token verification for protected routes
- Audit logging for all admin actions
- Responsive admin dashboard with 5 tabs:
  - Rewards Admin
  - Lending Admin
  - Insurance Admin
  - FX Admin
  - Business Admin

## Files to Create/Modify

### Backend

- [ ] server/routes/auth.js (enhance login endpoint)
- [ ] server/middleware/auth.js (enhance JWT middleware)
- [ ] server/routes/admin.js (create admin-specific routes)

### Frontend

- [ ] client/src/components/AdminLogin.jsx (create)
- [ ] client/src/components/AdminDashboard.jsx (create)
- [ ] client/src/App.js (add admin routes)
- [ ] client/src/utils/api.js (add admin API calls)

## Security Features

- Only admins can access /admin routes
- Non-admins redirected to /login
- JWT verification for all admin actions
- Audit log entries for admin operations
