@echo off
setlocal

cd /d "%~dp0"

echo Rolling the build number...
node scripts\bump-build.cjs
if errorlevel 1 (
  echo Failed to update the build number.
  exit /b 1
)

echo Building and packaging Oyama AI Video Studio for Windows...
call pnpm package:win
if errorlevel 1 (
  echo Windows packaging failed.
  exit /b 1
)

echo Build complete. Check the release folder for the installer.
exit /b 0
