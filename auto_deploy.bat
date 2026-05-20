@echo off
rem auto_deploy.bat - Automates fixing JSX syntax errors, updating tsconfig, linting, building, committing, and deploying on Windows.

rem Helper functions for colored output (using ANSI escape codes, works in newer Windows terminals)
set "ESC=\x1b"
set "RED=%ESC%[31m"
set "GREEN=%ESC%[32m"
set "YELLOW=%ESC%[33m"
set "BLUE=%ESC%[34m"
set "NC=%ESC%[0m"

set "log_info=echo %BLUE%[INFO]%NC%"
set "log_success=echo %GREEN%[SUCCESS]%NC%"
set "log_error=echo %RED%[ERROR]%NC%"

rem Ensure we are in the project root (directory of this script)
pushd "%~dp0"

rem Verify Node version (requires Node 22.x as defined in package.json)
%log_info% "Checking Node version..."
for /f "tokens=1 delims=." %%i in ('node -p "process.versions.node.split('.')[0]"') do set "CURRENT_NODE_MAJOR=%%i"
if "%CURRENT_NODE_MAJOR%"=="" (
    %log_error% "Node.js is not installed or not in PATH."
    exit /b 1
)
if %CURRENT_NODE_MAJOR% LSS 22 (
    %log_error% "Node.js version 22.x or higher is required. Current: %CURRENT_NODE_MAJOR%"
    exit /b 1
)
%log_success% "Node version %CURRENT_NODE_MAJOR% meets requirement."

rem Clean any existing node_modules to avoid permission issues
%log_info% "Cleaning existing node_modules..."
if exist client\node_modules rmdir /s /q client\node_modules
if exist server\node_modules rmdir /s /q server\node_modules
if exist node_modules rmdir /s /q node_modules

rem Install root dependencies (this will also install client/server via postinstall, but we will reinstall them explicitly)
%log_info% "Installing root dependencies (using npm install to ensure lock file is updated)..."
npm install || ( %log_error% "Root npm install failed" & exit /b 1 )

rem Install client dependencies explicitly
%log_info% "Installing client dependencies..."
pushd client
npm install || ( %log_error% "Client npm install failed" & popd & exit /b 1 )
popd

rem Install server dependencies explicitly
%log_info% "Installing server dependencies..."
pushd server
npm install || ( %log_error% "Server npm install failed" & popd & exit /b 1 )
popd

rem Run ESLint autofix on JSX files
%log_info% "Running ESLint autofix on JSX files..."
npm run lint -- --fix || ( %log_error% "ESLint autofix failed" & exit /b 1 )

rem Check tsconfig.json exists
%log_info% "Checking tsconfig.json..."
if not exist tsconfig.json (
    %log_error% "tsconfig.json not found!"
    exit /b 1
)
%log_success% "tsconfig.json exists."

rem Run full lint pass (without fixing)
%log_info% "Running full lint pass..."
npm run lint || ( %log_error% "Lint failed" & exit /b 1 )

rem Build the client application
%log_info% "Building client..."
npm run build || ( %log_error% "Build failed" & exit /b 1 )

rem Commit any changes made by the previous steps
%log_info% "Committing changes to git..."
git add -A
git commit -m "chore: automated fix, lint, build, and deploy" || ( %log_error% "Git commit failed" & exit /b 1 )

rem Deploy the application using the existing deploy.sh script (requires bash)
%log_info% "Running deployment script..."
where bash >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    bash ./deploy.sh || ( %log_error% "Deploy script failed" & exit /b 1 )
) else (
    %log_error% "Bash not found. Please run deploy.sh manually in a bash environment."
)

%log_success% "Automation script completed."
popd