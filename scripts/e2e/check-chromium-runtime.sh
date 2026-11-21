#!/usr/bin/env bash
set -euo pipefail

browser="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-$(node -e "process.stdout.write(require('@playwright/test').chromium.executablePath())")}"
if [[ ! -x "$browser" ]]; then
  echo "Playwright Chromium is not installed: $browser" >&2
  echo "Run: npx playwright install --with-deps chromium" >&2
  exit 1
fi

report="$(ldd "$browser" 2>&1)"
printf '%s\n' "$report"
if grep -q 'not found' <<<"$report"; then
  echo "Chromium has unresolved shared-library dependencies." >&2
  echo "On Debian/Ubuntu install them with: npx playwright install-deps chromium" >&2
  exit 1
fi

for library in libnspr4.so libnss3.so libnssutil3.so; do
  if ! grep -Fq "$library" <<<"$report"; then
    echo "Expected Chromium runtime dependency was not reported by ldd: $library" >&2
    exit 1
  fi
done

echo "Chromium runtime dependencies verified: libnspr4.so, libnss3.so, libnssutil3.so, and all other linked libraries resolve."
