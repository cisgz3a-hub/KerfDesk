#!/usr/bin/env bash

set -euo pipefail

version="${1:?Preview version is required}"
arch="${2:?Mac architecture is required}"
release_dir="release/${version}"
dmg="${release_dir}/KerfDesk-${version}-macos-${arch}.dmg"

test -f "${dmg}" || { echo "Missing canonical DMG: ${dmg}" >&2; exit 1; }

if find "${release_dir}" -type f \
  \( -name 'latest*.yml' -o -name 'latest*.yaml' -o -name 'latest*.json' -o -name '*.blockmap' \) \
  | grep -q .; then
  echo 'Preview emitted forbidden updater metadata.' >&2
  exit 1
fi

app_dir="$(find "${release_dir}" -type d -name 'KerfDesk.app' -print -quit)"
test -n "${app_dir}" || { echo 'KerfDesk.app was not produced.' >&2; exit 1; }
plist="${app_dir}/Contents/Info.plist"
executable="${app_dir}/Contents/MacOS/KerfDesk"

test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${plist}")" = 'com.kerfdesk.app'
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "${plist}")" = 'KerfDesk'
test "$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "${plist}")" = '12.0'
/usr/libexec/PlistBuddy -c 'Print :NSCameraUsageDescription' "${plist}" | grep -q 'KerfDesk'
/usr/libexec/PlistBuddy -c 'Print :NSLocalNetworkUsageDescription' "${plist}" | grep -q 'KerfDesk'
expected_macho_arch="${arch}"
if [[ "${arch}" == 'x64' ]]; then expected_macho_arch='x86_64'; fi
test "$(lipo -archs "${executable}")" = "${expected_macho_arch}"
node scripts/verify-packaged-preview-metadata.mjs \
  "${app_dir}/Contents/Resources/app.asar" "${version}"

test -f "${app_dir}/Contents/Resources/legal/LICENSE"
test -f "${app_dir}/Contents/Resources/legal/THIRD_PARTY_NOTICES.md"
test -f "${app_dir}/Contents/Resources/legal/third-party-notices.txt"
electron_resources="${app_dir}/Contents/Resources"
test -f "${electron_resources}/LICENSE"
test -f "${electron_resources}/LICENSES.chromium.html"

if xcrun stapler validate "${app_dir}"; then
  echo "Preview app unexpectedly has a notarization ticket: ${app_dir}" >&2
  exit 1
fi
if xcrun stapler validate "${dmg}"; then
  echo "Preview DMG unexpectedly has a notarization ticket: ${dmg}" >&2
  exit 1
fi

while IFS= read -r -d '' candidate; do
  details="$(codesign --display --verbose=4 "${candidate}" 2>&1 || true)"
  if grep -q '^Authority=' <<<"${details}"; then
    echo "Preview contains a distribution signing authority: ${candidate}" >&2
    exit 1
  fi
  if grep '^TeamIdentifier=' <<<"${details}" | grep -vq 'TeamIdentifier=not set'; then
    echo "Preview contains a trusted Team ID: ${candidate}" >&2
    exit 1
  fi
  if grep -q '^Signature=' <<<"${details}" && ! grep -q '^Signature=adhoc$' <<<"${details}"; then
    echo "Preview contains a non-ad-hoc signature: ${candidate}" >&2
    exit 1
  fi
done < <(find "${app_dir}" \
  \( -type d \( -name '*.app' -o -name '*.framework' -o -name '*.xpc' \) \
  -o -type f -perm -111 \) -print0)
