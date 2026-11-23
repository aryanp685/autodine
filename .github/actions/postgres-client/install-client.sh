#!/usr/bin/env bash
# Install the PostgreSQL client tools for one major version (default 17).
#
# The hosted backup and the hosted restore drill must use the SAME client
# major version: a custom-format dump written by pg_dump 17 carries archive
# format 1.16, which pg_restore 16 refuses ("unsupported version"). Pinning
# one major version on both sides removes that class of failure entirely.
#
# The runner image ships an older PostgreSQL client; the PostgreSQL APT
# repository (PGDG) provides the one we need. Nothing here reads or writes
# application data, and no database is contacted.
#
# Usage: install-client.sh <version>
set -euo pipefail

version="${1:-17}"

# Optional log file: when the caller sets PG_CLIENT_LOG, everything printed
# here is also written there, so a CI job can surface the tail as an
# annotation even when the log CDN is unreachable.
if [ -n "${PG_CLIENT_LOG:-}" ]; then
  exec > >(tee "$PG_CLIENT_LOG") 2>&1
fi

# Resolve the real binaries by absolute path. A caller may place a shim
# earlier on PATH (test harnesses do); resolving through PATH would make the
# install call itself and recurse.
resolve_real() {
  local name="$1" candidate resolved
  resolved=""
  IFS=':' read -r -a candidates <<< "${PATH:-}"
  for candidate in "${candidates[@]}"; do
    [ -n "$candidate" ] || continue
    if [ -x "$candidate/$name" ]; then resolved="$candidate/$name"; break; fi
  done
  if [ -z "$resolved" ]; then
    echo "install-client: FAILED: cannot find '$name' on PATH" >&2
    exit 1
  fi
  printf '%s\n' "$resolved"
}

APT_GET="$(resolve_real apt-get)"
INSTALL="$(resolve_real install)"
CURL="$(resolve_real curl)"

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    SUDO="$(resolve_real sudo)"
    "$SUDO" "$@"
  fi
}

# apt-get must never stop to ask a question: an unattended job would hang
# instead of failing.
export DEBIAN_FRONTEND=noninteractive

echo "install-client: installing PostgreSQL ${version} client tools"

as_root "$APT_GET" update
as_root "$APT_GET" install -y --no-install-recommends ca-certificates curl gnupg

# PGDG signing key + repository, pinned to the requested major version.
# The key is fetched to a temporary file and then installed with an explicit
# mode: installing a file onto itself is an error, and curl's default mode
# is not what apt wants for a keyring.
as_root "$INSTALL" -d -m 0755 /usr/share/postgresql-common/pgdg
key_tmp="$(mktemp)"
trap 'rm -f "$key_tmp"' EXIT
"$CURL" --fail --silent --show-error --location \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  --output "$key_tmp"
as_root "$INSTALL" -m 0644 "$key_tmp" /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc

. /etc/os-release
codename="${VERSION_CODENAME:-}"
if [ -z "$codename" ]; then
  echo "install-client: FAILED: cannot determine the distribution codename" >&2
  exit 1
fi
as_root sh -c "printf '%s\n' \
  'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${codename}-pgdg main' \
  > /etc/apt/sources.list.d/pgdg.list"

as_root "$APT_GET" update
as_root "$APT_GET" install -y --no-install-recommends "postgresql-client-${version}"

echo "install-client: PostgreSQL ${version} client installed"
