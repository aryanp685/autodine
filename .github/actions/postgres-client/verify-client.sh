#!/usr/bin/env bash
# Verify that the PostgreSQL client tools are present AND are the requested
# major version, then publish the directory on PATH for later steps.
#
# Fail closed: a missing binary, an unreadable version string, or a version
# that is not the requested major version all abort the job. A silently
# mismatched pg_restore is worse than no pg_restore — it fails later, inside
# a restore, with a confusing message.
#
# Usage: verify-client.sh <version> <bin-dir>
set -euo pipefail

version="${1:-17}"
# `${2-...}` and not `${2:-...}`: an explicitly empty second argument must
# stay empty so the guard below can refuse it.
bin_dir="${2-/usr/lib/postgresql/17/bin}"

if [ -z "$bin_dir" ] || [ "$bin_dir" = "/" ]; then
  echo "verify-client: FAILED: refusing an empty or root binary directory" >&2
  exit 1
fi

# The major version reported by the client, e.g. "17" from
# "pg_restore (PostgreSQL) 17.6 (Debian 17.6-1)".
major_of() {
  local output major
  output="$("$1" --version 2>/dev/null || true)"
  major="$(printf '%s' "$output" | grep -oE '[0-9]+(\.[0-9]+)?' | head -n 1 || true)"
  if [ -z "$major" ]; then return 1; fi
  printf '%s\n' "${major%%.*}"
}

for tool in psql pg_restore; do
  binary="$bin_dir/$tool"
  if [ ! -x "$binary" ]; then
    echo "verify-client: FAILED: $binary is missing or not executable — the PostgreSQL ${version} client is required" >&2
    exit 1
  fi
  actual="$(major_of "$binary")" || {
    echo "verify-client: FAILED: could not read a version from $binary" >&2
    exit 1
  }
  if [ "$actual" != "$version" ]; then
    echo "verify-client: FAILED: $binary is PostgreSQL ${actual}, expected ${version}" >&2
    exit 1
  fi
  echo "verify-client: $binary is PostgreSQL ${actual}"
done

if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$bin_dir" >> "$GITHUB_PATH"
fi

echo "verify-client: PostgreSQL ${version} client verified at ${bin_dir}"
