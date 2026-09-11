@echo off
setlocal
cd /d "%~dp0.."

echo macOS packages must be built on a Mac.
echo Copy this checkout to macOS, then run: sh scripts/release-mac.sh
exit /b 1
