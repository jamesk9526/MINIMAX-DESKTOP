#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."
pnpm package:mac
