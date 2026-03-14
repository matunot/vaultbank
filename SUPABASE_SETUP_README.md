# VaultBank Supabase Database Setup

## 🚀 Quick Setup Guide

Your VaultBank database schema is ready! Follow these steps to set up your Supabase database.

---

## Step 1: Access Supabase Dashboard

1. Go to [supabase.com](https://supabase.com) and sign in
2. Select your **VaultBank** project (or create one if needed)
3. Go to **SQL Editor** in the left sidebar

---

## Step 2: Run the Migrations

### Option A: Copy-Paste Method (Recommended)

1. Open the file `supabase_migrations.sql` in your project
2. Copy **ALL** the SQL code
3. Paste it into the Supabase SQL Editor
4. Click **Run** (or press Ctrl+Enter)

### Option B: File Upload Method

1. In SQL Editor, click **Upload SQL file**
2. Select your `supabase_migrations.sql` file
3. Click **Run**

---

## Step 3: Verify Setup

After running the migrations, check that all tables were created:

```sql
-- Run this query in Supabase SQL Editor to verify
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

**Expected tables:**

- `users`
- `accounts`
- `transactions`
- `cards`
- `rewards`
- `alerts`

---

## Step 4: Update Environment Variables

Your `.env` file should already have the correct Supabase credentials. If needed, update them from your Supabase dashboard:

```bash
# In server/.env
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_ANON_KEY="your-anon-key"
```

---

## 📊 Database Schema Overview

### 🔐 Security Features

- **Row Level Security (RLS)** enabled on all tables
- **Users can only access their own data**
- **Secure by default** - no data leakage between users

### 📋 Table Relationships

```
Users (id) ──┬── Accounts (user_id)
             │
             ├── Cards (user_id)
             │
             ├── Rewards (user_id)
             │
             └── Alerts (user_id)

Accounts (id) ─── Transactions (from_account_id/to_account_id)
```

### 🎯 Key Features

1. **Auto User Creation**: When someone signs up via Supabase Auth, a `users` record is automatically created
2. **Default Rewards**: New users get a Silver tier rewards profile automatically
3. **Foreign Key Constraints**: All relationships are properly enforced
4. **Performance Indexes**: Optimized for common query patterns
5. **Data Validation**: Check constraints prevent invalid data

---

## 🧪 Testing the Setup

### Create a Test User

1. Use your app's signup/login to create a user
2. Check Supabase dashboard → **Users** tab
3. You should see the user in both `auth.users` and `public.users`

### Verify RLS Policies

1. Try accessing the database directly from a client
2. You should only see data for the authenticated user
3. Other users' data should be invisible

### Sample Queries

```sql
-- Check your user profile
SELECT * FROM users WHERE id = auth.uid();

-- View your accounts
SELECT * FROM accounts WHERE user_id = auth.uid();

-- View recent transactions
SELECT * FROM transactions
WHERE from_account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid())
ORDER BY created_at DESC LIMIT 10;
```

---

## 🔧 Troubleshooting

### If tables don't appear:

- Make sure the SQL ran without errors
- Check the Supabase dashboard → **Database** → **Tables**

### If RLS policies fail:

- Ensure you're using the correct anon key
- Check that the user is properly authenticated
- Verify the JWT token is valid

### If signup doesn't create user record:

- The database trigger might have failed
- Check Supabase logs → **Database** → **Logs**

---

## 📈 Next Steps

Once the database is set up:

1. **Update your backend routes** to use Supabase instead of mock data
2. **Test all CRUD operations** (Create, Read, Update, Delete)
3. **Implement premium features** with subscription gating
4. **Add payment processing** for premium upgrades

---

## 📝 Notes

- **Backup**: Always backup before running migrations in production
- **Development**: Use a separate Supabase project for development
- **Environment Variables**: Never commit real keys to version control
- **Security**: RLS policies ensure data isolation between users

---

**🎉 Ready to build real banking features!** Your database now supports user accounts, transactions, cards, rewards, and alerts with full security and performance optimizations.
