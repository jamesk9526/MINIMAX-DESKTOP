#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

for tool in node pnpm fpm; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required Linux release tool: $tool" >&2
    echo "Install Node.js, pnpm, and fpm, then run this script again." >&2
    exit 1
  fi
done

pnpm package:linux:deb
