@echo off
setlocal
cd /d "%~dp0.."

echo Building MiniMax Studio ZIP and Debian package for Linux x64...
call pnpm package:linux
if errorlevel 1 (
  echo Linux package failed.
  exit /b %errorlevel%
)

echo.
echo Linux ZIP and Debian package release artifacts are in the release folder.
echo For an AppImage or tarball, run pnpm package:linux:appimage or pnpm package:linux:tar from a Linux build machine.
