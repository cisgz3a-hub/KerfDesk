#!/usr/bin/env bash
# The Linux package contract (ADR-607): the AppImage and the .deb carry the
# KerfDesk identity, the legal files, the .lf2 MIME type and a desktop entry
# that opens it, and no updater metadata. Runs on Linux, where dpkg-deb exists.
# With --commercial, app.asar must carry the unsigned commercial lane's signed
# release identity instead of the Preview metadata (ADR-613).
#
# usage: bash scripts/verify-linux-package.sh <version> [release directory] [--commercial <identity.json>]

set -euo pipefail

version="${1:?Package version is required}"
release_dir="${2:-release/${version}}"
identity=''
if [[ $# -gt 2 ]]; then
  if [[ $# -ne 4 || "${3}" != '--commercial' || -z "${4}" ]]; then
    echo 'usage: verify-linux-package.sh <version> [release directory] [--commercial <identity.json>]' >&2
    exit 1
  fi
  identity="${4}"
fi
appimage="${release_dir}/KerfDesk-${version}-linux-x86_64.AppImage"
deb="${release_dir}/KerfDesk-${version}-linux-amd64.deb"
mime_type='application/x-kerfdesk-project'

fail() {
  echo "$*" >&2
  exit 1
}

test -f "${appimage}" || fail "Missing AppImage: ${appimage}"
test -x "${appimage}" || fail "The AppImage is not executable: ${appimage}"
test -f "${deb}" || fail "Missing .deb: ${deb}"

if find "${release_dir}" -maxdepth 1 -type f \
  \( -name 'latest*.yml' -o -name 'latest*.yaml' -o -name 'latest*.json' -o -name '*.blockmap' \) \
  | grep -q .; then
  fail 'The Linux package emitted updater metadata.'
fi

# The desktop entry: the right program, the project type, and window grouping.
check_desktop_entry() {
  local entry="${1:?desktop entry is required}"
  local exec_line="${2:?Exec line is required}"
  grep -qx 'Name=KerfDesk' "${entry}" || fail "${entry}: Name is not KerfDesk"
  grep -qx "Exec=${exec_line}" "${entry}" || fail "${entry}: Exec is not ${exec_line}"
  grep -qx 'Icon=kerfdesk' "${entry}" || fail "${entry}: Icon is not kerfdesk"
  grep -qx 'StartupWMClass=kerfdesk' "${entry}" || fail "${entry}: StartupWMClass is not kerfdesk"
  grep -qx "MimeType=${mime_type};" "${entry}" || fail "${entry}: MimeType does not claim .lf2"
  grep -qx 'Categories=Graphics;' "${entry}" || fail "${entry}: Categories is not Graphics"
}

# The shared-mime-info file: .lf2 is the KerfDesk project type, and nothing else is claimed.
check_mime_file() {
  local mime="${1:?MIME file is required}"
  grep -q "type=\"${mime_type}\"" "${mime}" || fail "${mime}: no ${mime_type} type"
  grep -q 'pattern="\*\.lf2"' "${mime}" || fail "${mime}: no *.lf2 glob"
  if grep -q 'pattern="\*\.lbrn' "${mime}"; then fail "${mime}: claims LightBurn files"; fi
}

# What the packaged app reads from app.asar: Preview metadata, or the commercial
# lane's licensing and signed release identity.
check_metadata() {
  local archive="${1:?app.asar is required}"
  if [[ -n "${identity}" ]]; then
    node scripts/verify-packaged-commercial-metadata.mjs "${archive}" "${version}" "${identity}"
  else
    node scripts/verify-packaged-preview-metadata.mjs "${archive}" "${version}"
  fi
}

check_legal_files() {
  local resources="${1:?resources folder is required}"
  for file in legal/LICENSE legal/THIRD_PARTY_NOTICES.md legal/third-party-notices.txt app.asar; do
    test -f "${resources}/${file}" || fail "Missing ${resources}/${file}"
  done
  grep -q 'All rights reserved' "${resources}/legal/LICENSE" ||
    fail "${resources}/legal/LICENSE is not the KerfDesk licence"
  # An installed copy reads its update feed from here; no Linux feed exists yet.
  test ! -e "${resources}/app-update.yml" || fail "${resources}/app-update.yml names an update feed"
}

# Electron's and Chromium's licence files, which electron-builder keeps next to
# the executable on Linux, as the Windows and macOS package checks require.
check_electron_notices() {
  local app_dir="${1:?app folder is required}"
  for file in LICENSE.electron.txt LICENSES.chromium.html; do
    test -s "${app_dir}/${file}" || fail "Missing or empty ${app_dir}/${file}"
  done
}

# The libraries electron-builder copies from its AppImage toolset into usr/lib.
# Each is listed, with its licence, in docs/licensing/appimage-runtime-notices.txt
# (ADR-017 Amendment 1); a library not named there must be added to the notices first.
# The GPL-3.0 libraries and GConf are left out by scripts/appimage-toolset.mjs
# (ADR-017 Amendment 2), so the AppImage must not carry them.
check_appimage_libraries() {
  local lib_dir="${1:?usr/lib folder is required}"
  test -d "${lib_dir}" || return 0
  local name
  while IFS= read -r name; do
    case "${name}" in
      libXss.so.1* | libXtst.so.6* | libnotify.so.4*) ;;
      libappindicator3.so.1* | libindicator3.so.7* | libgconf-2.so.4*)
        fail "The AppImage carries usr/lib/${name}, which KerfDesk leaves out (ADR-017 Amendment 2)" ;;
      *) fail "The AppImage carries usr/lib/${name}, which the third-party notices do not list" ;;
    esac
  done < <(find "${lib_dir}" -mindepth 1 -printf '%P\n' | sort)
  echo "AppImage usr/lib: $(find "${lib_dir}" -mindepth 1 -printf '%P\n' | sort | tr '\n' ' ')"
}

# Nothing the AppImage carries links a left-out library, so leaving them out
# cannot stop KerfDesk loading; at most a loader that asks for one finds none.
check_no_left_out_links() {
  local root="${1:?AppImage folder is required}"
  command -v readelf >/dev/null || fail 'readelf is required to check the AppImage libraries'
  local needed
  needed="$( (find "${root}" -type f \( -name kerfdesk -o -name '*.so' -o -name '*.so.*' \) \
    -exec readelf -d {} + 2>/dev/null || true) | sed -n 's/.*(NEEDED).*\[\(.*\)\]$/\1/p' | sort -u)"
  test -n "${needed}" || fail "readelf found no linked libraries in ${root}"
  if grep -E '^(libappindicator3\.so\.1|libindicator3\.so\.7|libgconf-2\.so\.4)' <<<"${needed}"; then
    fail 'Something in the AppImage links a library KerfDesk leaves out (ADR-017 Amendment 2)'
  fi
}

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# --- .deb ---
deb_version="${version//-/\~}"
test "$(dpkg-deb -f "${deb}" Package)" = kerfdesk || fail '.deb Package is not kerfdesk'
test "$(dpkg-deb -f "${deb}" Version)" = "${deb_version}" || fail ".deb Version is not ${deb_version}"
test "$(dpkg-deb -f "${deb}" Architecture)" = amd64 || fail '.deb Architecture is not amd64'
dpkg-deb -f "${deb}" Maintainer | grep -q 'support@kerfdesk.com' || fail '.deb Maintainer is wrong'
dpkg-deb -x "${deb}" "${work}/deb"
test -x "${work}/deb/opt/KerfDesk/kerfdesk" || fail '.deb has no /opt/KerfDesk/kerfdesk'
test -f "${work}/deb/opt/KerfDesk/chrome-sandbox" || fail '.deb has no Chromium sandbox helper'
test -f "${work}/deb/opt/KerfDesk/resources/apparmor-profile" || fail '.deb has no AppArmor profile'
check_legal_files "${work}/deb/opt/KerfDesk/resources"
check_electron_notices "${work}/deb/opt/KerfDesk"
check_desktop_entry "${work}/deb/usr/share/applications/kerfdesk.desktop" '/opt/KerfDesk/kerfdesk %U'
check_mime_file "${work}/deb/usr/share/mime/packages/kerfdesk.xml"
test -f "${work}/deb/usr/share/icons/hicolor/512x512/apps/kerfdesk.png" || fail '.deb has no 512px icon'
check_metadata "${work}/deb/opt/KerfDesk/resources/app.asar"

# --- AppImage --- (extracted, so the check needs no FUSE)
appimage_path="$(realpath "${appimage}")"
(cd "${work}" && "${appimage_path}" --appimage-extract >/dev/null)
root="${work}/squashfs-root"
test -x "${root}/AppRun" || fail 'AppImage has no AppRun'
# The desktop entry adds no --no-sandbox (ADR-607), so the launcher itself must
# drop Chromium's sandbox where the system blocks user namespaces.
grep -q 'unshare -Ur true' "${root}/AppRun" || fail 'AppRun has no user namespace check'
grep -q 'NO_SANDBOX=(--no-sandbox)' "${root}/AppRun" || fail 'AppRun has no sandbox fallback'
test -x "${root}/kerfdesk" || fail 'AppImage has no kerfdesk executable'
check_legal_files "${root}/resources"
check_electron_notices "${root}"
check_appimage_libraries "${root}/usr/lib"
check_no_left_out_links "${root}"
check_desktop_entry "${root}/kerfdesk.desktop" 'AppRun %U'
check_metadata "${root}/resources/app.asar"

echo "Linux package contract passed for KerfDesk ${version}."
