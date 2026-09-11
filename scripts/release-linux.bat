@echo off
setlocal
cd /d "%~dp0.."

echo Building portable MiniMax Studio ZIP for Linux x64...
call pnpm package:linux
if errorlevel 1 (
  echo Linux package failed.
  exit /b %errorlevel%
)

echo.
echo Linux ZIP release artifact is in the release folder.
echo For a Debian package, run sh scripts/release-linux-deb.sh from Linux or WSL after installing Node.js, pnpm, and fpm.
echo For an AppImage or tarball, run pnpm package:linux:appimage or pnpm package:linux:tar from a Linux build machine.
