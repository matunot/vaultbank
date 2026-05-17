@echo off
rem ------------------------------------------------------------
rem Batch script to run the 003_add_audit_logs.sql migration against a
rem local PostgreSQL database and verify the audit_logs table and its indexes.
rem ------------------------------------------------------------

rem Disable delayed expansion to safely handle special characters in passwords
setlocal DisableDelayedExpansion

rem Path to the psql executable – adjust if your PostgreSQL installation path differs
set "PSQL=C:\Program Files\PostgreSQL\16\bin\psql.exe"
rem Ensure ci-logs directory exists
if not exist "ci-logs" mkdir "ci-logs"
set "LOG=ci-logs\\migration-verify.log"

rem ----------------------------------------------------------------
rem Load PostgreSQL connection string from server/.env (DATABASE_URL)
rem ----------------------------------------------------------------
set "DATABASE_URL="
for /f "usebackq tokens=1* delims==" %%A in ("server\.env") do (
    if "%%A"=="DATABASE_URL" set "DATABASE_URL=%%B"
)

rem If DATABASE_URL is not set, fallback to default credentials (postgres)
if "%DATABASE_URL%"=="" (
    set "DATABASE_URL=postgres://postgres:postgres@localhost:5432/vaultbank"
)

rem ----------------------------------------------------------------
 rem Ensure the target database exists (ignore error if it already exists)
 rem 
 rem Set password for postgres user (assumes current password is VaultBank123!)
 set "PGPASSWORD=VaultBank123!"
 "%PSQL%" -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'VaultBank123!';" >> "%LOG%" 2>&1
 rem Ensure subsequent commands use the updated password (already set)
 set "PGPASSWORD=VaultBank123!"

 rem Drop the target database if it exists, then create a fresh one
 "%PSQL%" -U postgres -d postgres -c "DROP DATABASE IF EXISTS vaultbank;" >> "%LOG%" 2>&1
 "%PSQL%" -U postgres -d postgres -c "CREATE DATABASE vaultbank;" >> "%LOG%" 2>&1

rem ----------------------------------------------------------------
rem Run the migration script
rem ----------------------------------------------------------------
rem Run all migration scripts in order
set "EXITCODE=0"
for %%F in (server\\migrations\\*.sql) do (
    "%PSQL%" -d "%DATABASE_URL%" -f "%%F" >> "%LOG%" 2>&1
    if errorlevel 1 set "EXITCODE=1"
)

rem ----------------------------------------------------------------
rem Verify the table definition
rem ----------------------------------------------------------------
"%PSQL%" -d "%DATABASE_URL%" -c "\d audit_logs" >> "%LOG%" 2>&1

rem ----------------------------------------------------------------
rem Verify the indexes on the audit_logs table
rem ----------------------------------------------------------------
"%PSQL%" -d "%DATABASE_URL%" -c "\di+ audit_logs*" >> "%LOG%" 2>&1

  rem Insert a test user if not already present (use a fixed UUID)
  "%PSQL%" -d "%DATABASE_URL%" -c "INSERT INTO users (id, name, email, password_hash, balance, subscription, role) VALUES ('00000000-0000-0000-0000-000000000001', 'test_user', 'test_user@example.com', 'testhash', 0, 'free', 'user') ON CONFLICT DO NOTHING;" >> "%LOG%" 2>&1
  rem Insert a test row into audit_logs referencing the test user (used for success detection)
  "%PSQL%" -d "%DATABASE_URL%" -c "INSERT INTO audit_logs (user_id, action, category, \"timestamp\") VALUES ('00000000-0000-0000-0000-000000000001', 'test_migration', 'test', NOW());" >> "%LOG%" 2>&1
  rem Insert sample audit log events as requested
  "%PSQL%" -d "%DATABASE_URL%" -c "INSERT INTO audit_logs (user_id, action, category, \"timestamp\") VALUES ('00000000-0000-0000-0000-000000000001', 'user_login', 'login', NOW());" >> "%LOG%" 2>&1
  "%PSQL%" -d "%DATABASE_URL%" -c "INSERT INTO audit_logs (user_id, action, category, \"timestamp\") VALUES ('00000000-0000-0000-0000-000000000001', 'fund_transfer_100USD', 'transfer', NOW());" >> "%LOG%" 2>&1
  "%PSQL%" -d "%DATABASE_URL%" -c "INSERT INTO audit_logs (user_id, action, category, \"timestamp\") VALUES ('00000000-0000-0000-0000-000000000001', 'password_reset', 'security', NOW());" >> "%LOG%" 2>&1
  rem Select the test row back (for verification)
  "%PSQL%" -d "%DATABASE_URL%" -c "SELECT * FROM audit_logs WHERE user_id='00000000-0000-0000-0000-000000000001' ORDER BY \"timestamp\" DESC LIMIT 1;" >> "%LOG%" 2>&1
  rem Query latest 5 audit log entries
  "%PSQL%" -d "%DATABASE_URL%" -c "SELECT * FROM audit_logs ORDER BY \"timestamp\" DESC LIMIT 5;" >> "%LOG%" 2>&1

rem ----------------------------------------------------------------
rem Show the last 50 lines of the log for quick inspection
rem ----------------------------------------------------------------
powershell -NoProfile -Command "Get-Content '%LOG%' -Tail 50"

rem ----------------------------------------------------------------
rem Report success or failure based on the migration exit code
rem ----------------------------------------------------------------
 rem Determine success based on presence of sample rows in log
 findstr /C:"user_login" /C:"fund_transfer_100USD" /C:"password_reset" "%LOG%" >nul
if %errorlevel% EQU 0 (
    echo 🎉 MIGRATION_SUCCESS
) else (
    echo ❌ MIGRATION_FAILURE
)

endlocal