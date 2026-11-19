#!/usr/bin/env bash
# Install Chromium for the browser suites, with a bounded retry.
#
# WHY A RETRY
#
# `playwright install --with-deps` downloads a browser build AND installs its
# Linux runtime libraries. Both halves talk to the network, and both fail
# intermittently on a shared runner: a truncated download, a mirror that
# answers 503, an apt refresh that trips over a transient mirror error.
#
# None of those say anything about this repository. A job that dies on one of
# them reports a red run for a cause no code change can fix — and it does so
# at the very first step, so every assertion in the job never runs.
#
# So the install is tried again. The retry is BOUNDED, and the last
# attempt's exit code is the job's exit code: if Chromium genuinely cannot
# be installed, the job still fails, loudly, on that.
#
# Usage: scripts/e2e/install-chromium.sh [attempts]
set -euo pipefail

attempts="${1:-${CHROMIUM_INSTALL_ATTEMPTS:-3}}"
if ! [[ "$attempts" =~ ^[0-9]+$ ]] || [ "$attempts" -lt 1 ]; then
  echo "install-chromium: attempts must be a positive integer, got '${attempts}'" >&2
  exit 2
fi

for attempt in $(seq 1 "$attempts"); do
  echo "installing Chromium (attempt ${attempt}/${attempts})"
  if npx playwright install --with-deps chromium; then
    echo "Chromium installed."
    exit 0
  fi
  echo "install-chromium: attempt ${attempt} failed." >&2
  if [ "$attempt" -lt "$attempts" ]; then
    # Back off a little longer each time, but never long enough to look like
    # a hang: the whole point is to get past a momentary network fault.
    sleep $(( attempt * 10 ))
  fi
done

echo "install-chromium: Chromium could not be installed after ${attempts} attempts." >&2
exit 1
