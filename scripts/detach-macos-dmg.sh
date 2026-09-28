#!/usr/bin/env bash

# Unmounts a Preview DMG that a check mounted read-only. Right after the checks
# read the volume, macOS background services (Spotlight, the code-signing and
# malware scanners) can still hold it, and hdiutil fails with "Resource busy"
# (exit 16). Retry, then force, as electron-builder's own dmg-builder does. The
# volume is read-only, so forcing it loses nothing.

set -euo pipefail

mount_dir="${1:?mount point is required}"
attempts=5

for ((attempt = 1; attempt <= attempts; attempt++)); do
  if output="$(hdiutil detach "${mount_dir}" 2>&1)"; then
    exit 0
  fi
  echo "Unmount attempt ${attempt} of ${attempts} failed: ${output}" >&2
  sleep 2
done

echo "Forcing the unmount of ${mount_dir}." >&2
hdiutil detach -force "${mount_dir}" >/dev/null
