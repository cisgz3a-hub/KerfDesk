#!/usr/bin/env bash
# The Linux package contract (ADR-607): the AppImage and the .deb carry the
# KerfDesk identity, the legal files, the .lf2 MIME type and a desktop entry
# that opens it, and no updater metadata. Runs on Linux, where dpkg-deb exists.
#
# usage: bash scripts/verify-linux-package.sh <version> [release directory]

set -euo pipefail

version="${1:?Package version is required}"
release_dir="${2:-release/${version}}"
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
check_desktop_entry "${work}/deb/usr/share/applications/kerfdesk.desktop" '/opt/KerfDesk/kerfdesk %U'
check_mime_file "${work}/deb/usr/share/mime/packages/kerfdesk.xml"
test -f "${work}/deb/usr/share/icons/hicolor/512x512/apps/kerfdesk.png" || fail '.deb has no 512px icon'
node scripts/verify-packaged-preview-metadata.mjs "${work}/deb/opt/KerfDesk/resources/app.asar" "${version}"

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
check_desktop_entry "${root}/kerfdesk.desktop" 'AppRun %U'
node scripts/verify-packaged-preview-metadata.mjs "${root}/resources/app.asar" "${version}"

echo "Linux package contract passed for KerfDesk ${version}."
