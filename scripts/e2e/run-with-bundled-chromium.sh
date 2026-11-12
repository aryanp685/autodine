#!/usr/bin/env bash
set -euo pipefail

if (($# == 0)); then
  echo "Usage: $0 <command> [args...]" >&2
  exit 2
fi

# @sparticuz/chromium ships both the browser and its Amazon Linux 2023 NSS/NSPR
# libraries. Isolate extraction under a fresh temporary directory so a stale
# Chromium binary cannot hide a missing-library extraction.
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/autodine-chromium.XXXXXX")"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

export TMPDIR="$tmpdir"
export AWS_EXECUTION_ENV="${AWS_EXECUTION_ENV:-AWS_Lambda_nodejs22.x}"
export LD_LIBRARY_PATH="$TMPDIR/al2023/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="$(node --input-type=module -e "import chromium from '@sparticuz/chromium'; process.stdout.write(await chromium.executablePath())")"

./scripts/e2e/check-chromium-runtime.sh
"$@"
