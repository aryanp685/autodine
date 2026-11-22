#!/usr/bin/env bash
# Verify that the PostgreSQL client tools are present AND are the requested
# major version, then publish the directory on PATH for later steps.
#
# ALL THREE TOOLS ARE CHECKED: psql, pg_dump AND pg_restore.
#
# pg_dump is the one that WRITES the archive and pg_restore is the one that
# READS it. A custom-format dump written by pg_dump 17 carries an archive
# format pg_restore 16 refuses outright ("unsupported version"), so the pair
# that matters is the writer/reader pair. Checking only psql and pg_restore
# left the writer unverified — the binary that decides the archive format
# was the one binary nobody looked at.
#
# Fail closed: a missing binary, a binary that is not executable, an
# unreadable version string, a version that is not the requested major
# version, and a binary that is SHADOWED by another PATH entry all abort the
# job. A silently mismatched pg_restore is worse than no pg_restore — it
# fails later, inside a restore, with a confusing message.
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

# Optional log file: when the caller sets PG_CLIENT_LOG, everything printed
# here is also written there, so a CI job can surface the tail as an
# annotation even when the log CDN is unreachable. The install step already
# does this; the verification step must too, because a version mismatch is
# the failure a human actually needs to read.
if [ -n "${PG_CLIENT_LOG:-}" ]; then
  exec > >(tee "$PG_CLIENT_LOG") 2>&1
fi

# Every tool the backup/restore pair needs.
TOOLS="psql pg_dump pg_restore"

# The major version reported by the client, e.g. "17" from
# "pg_restore (PostgreSQL) 17.6 (Debian 17.6-1)".
major_of() {
  local output major
  output="$("$1" --version 2>/dev/null || true)"
  major="$(printf '%s' "$output" | grep -oE '[0-9]+(\.[0-9]+)?' | head -n 1 || true)"
  if [ -z "$major" ]; then return 1; fi
  printf '%s\n' "${major%%.*}"
}

# The canonical path of a file, following symlinks. Used to compare "the
# binary that was verified" with "the binary that will run", which is the
# only comparison that proves anything.
real_path() {
  if command -v readlink >/dev/null 2>&1; then
    readlink -f "$1" 2>/dev/null || printf '%s\n' "$1"
  else
    printf '%s\n' "$1"
  fi
}

fail() {
  echo "verify-client: FAILED: $1" >&2
  exit 1
}

# Step 1 — every tool must exist, be executable, and be the requested major
# version. This is checked against the pinned directory, by absolute path, so
# a PATH entry cannot influence the answer.
for tool in $TOOLS; do
  binary="$bin_dir/$tool"
  if [ ! -x "$binary" ]; then
    fail "$binary is missing or not executable — the PostgreSQL ${version} client is required"
  fi
  actual="$(major_of "$binary")" || fail "could not read a version from $binary"
  if [ "$actual" != "$version" ]; then
    fail "$binary is PostgreSQL ${actual}, expected ${version}"
  fi
  echo "verify-client: $binary is PostgreSQL ${actual}"
done

# Step 2 — prove what PATH will actually resolve to.
#
# The runner image ships a manually installed pg_dump 16 that can shadow the
# PGDG wrapper in PATH. GITHUB_PATH is prepended by GitHub for every later
# step, so the PGDG directory wins — but "wins" has to be checked, not
# assumed, and a later step that writes to GITHUB_PATH can reorder PATH
# again. So: prepend the pinned directory exactly as GitHub will, resolve
# each tool, and REFUSE when the resolved binary is not the verified one.
export PATH="$bin_dir:$PATH"
for tool in $TOOLS; do
  winner="$(command -v "$tool" 2>/dev/null || true)"
  if [ -z "$winner" ]; then
    fail "$tool does not resolve on PATH after the pinned directory was published"
  fi
  if [ "$(real_path "$winner")" != "$(real_path "$bin_dir/$tool")" ]; then
    fail "$tool resolves to $winner, which is not the verified $bin_dir/$tool — a shadowing PATH entry would run an unverified client"
  fi
  winner_major="$(major_of "$winner")" || fail "could not read a version from the resolved $winner"
  if [ "$winner_major" != "$version" ]; then
    fail "$tool resolves to $winner, which is PostgreSQL ${winner_major}, expected ${version}"
  fi
done

# Publish the directory so later steps resolve the verified binaries.
if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$bin_dir" >> "$GITHUB_PATH"
fi

# Publish the pinned directory and version so the scripts that run
# pg_dump / pg_restore can use ABSOLUTE paths instead of trusting PATH.
if [ -n "${GITHUB_ENV:-}" ]; then
  {
    printf 'PG_CLIENT_BIN_DIR=%s\n' "$bin_dir"
    printf 'PG_CLIENT_VERSION=%s\n' "$version"
  } >> "$GITHUB_ENV"
fi

# Prove what resolves, for the record.
echo "verify-client: path resolution for the PostgreSQL client tools:"
for tool in $TOOLS; do
  echo "  which -a $tool:"
  which -a "$tool" 2>/dev/null | sed 's/^/    /' || echo "    (not found)"
done

echo "verify-client: PostgreSQL ${version} client verified at ${bin_dir}"
