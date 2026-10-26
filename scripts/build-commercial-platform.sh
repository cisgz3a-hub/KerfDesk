#!/usr/bin/env bash
# Build and qualify one system's unsigned commercial package (ADR-613) from the
# release identity the Windows job already signed. It never holds a signing key.
# The release workflow runs it before publication, and the Desktop package
# check rehearses it with a throwaway identity. A qualified file's SHA-256 is
# written to GITHUB_OUTPUT as `digests`, which is all the publish job accepts.
#
# Expects the renderer and Electron main already built at <version>.
#
# usage: bash scripts/build-commercial-platform.sh <macos|linux> <arm64|x64> <version> <source-sha> <identity.json>

set -euo pipefail

platform="${1:?macos or linux is required}"
arch="${2:?arm64 or x64 is required}"
version="${3:?release version is required}"
source_sha="${4:?release source SHA is required}"
identity_input="${5:?signed release identity is required}"

case "${platform}/${arch}" in
  macos/arm64 | macos/x64 | linux/x64) ;;
  *)
    echo "No commercial ${platform} ${arch} package exists." >&2
    exit 1
    ;;
esac
if [[ -n "${DESKTOP_STABLE_MANIFEST_PRIVATE_KEY:-}${DESKTOP_STABLE_MANIFEST_PRIVATE_KEY_FILE:-}" ]]; then
  echo 'A macOS or Linux build must not hold the release signing key.' >&2
  exit 1
fi

work="${RUNNER_TEMP:?RUNNER_TEMP is required}/commercial-${platform}-${arch}"
preparation="${work}/preparation"
release="release/commercial-unsigned/${version}"
mkdir -p "${work}"
cp public/eula.txt "${work}/kerfdesk-installer-terms.txt"
node scripts/prepare-commercial-desktop.mjs --unsigned-installer --platform "${platform}" \
  --output-dir "${preparation}" --terms-file "${work}/kerfdesk-installer-terms.txt" \
  --version "${version}" --source-sha "${source_sha}" --release-identity "${identity_input}"
identity="${preparation}/commercial-release-identity.json"
config="${preparation}/electron-builder.commercial-unsigned.generated.json"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

if [[ "${platform}" == macos ]]; then
  CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --config "${config}" \
    --mac "--${arch}" --publish never
  dmg="${release}/KerfDesk-${version}-macos-${arch}.dmg"
  bash scripts/verify-macos-preview-package.sh "${version}" "${arch}" "${release}" \
    --commercial "${identity}"

  # Fuses and app.asar, then launch the licence window from inside the DMG,
  # as a new operator opening this commercial build would (ADR-623). While
  # ADR-623 Amendment 3 holds that window off, --expect-licence-window expects
  # the unlicensed KerfDesk Free workspace instead, with its import and save.
  mount_dir="$(mktemp -d)"
  hdiutil attach -readonly -nobrowse -mountpoint "${mount_dir}" "${dmg}" >/dev/null
  trap 'bash scripts/detach-macos-dmg.sh "${mount_dir}"' EXIT
  app="${mount_dir}/KerfDesk.app"
  # The Mac build uses the Preview's fuse set (electron-builder.commercial-unsigned-macos.yml).
  node scripts/verify-packaged-desktop.mjs \
    "${app}/Contents/Frameworks/Electron Framework.framework/Electron Framework" \
    "${app}/Contents/Resources/app.asar" electron-builder.preview.yml
  pnpm smoke:desktop:native -- "${app}/Contents/MacOS/KerfDesk" --expect-licence-window
  bash scripts/detach-macos-dmg.sh "${mount_dir}"
  trap - EXIT

  unpacked="$(pwd)/$(ls -d "${release}"/mac*/KerfDesk.app)"
  # The unlicensed baseline opens behind its licence window (ADR-623), or in
  # KerfDesk Free while Amendment 3 holds it off.
  node scripts/verify-asar-integrity-enforced.mjs --expect-licence-window \
    "${unpacked}/Contents/MacOS/KerfDesk" "${unpacked}/Contents/Resources/app.asar"
  files=("${dmg}")
else
  pnpm exec electron-builder --config "${config}" --linux --x64 --publish never
  deb="${release}/KerfDesk-${version}-linux-amd64.deb"
  appimage="$(pwd)/${release}/KerfDesk-${version}-linux-x86_64.AppImage"
  bash scripts/verify-linux-package.sh "${version}" "${release}" --commercial "${identity}"
  node scripts/verify-packaged-desktop.mjs "${release}/linux-unpacked/kerfdesk" \
    "${release}/linux-unpacked/resources/app.asar" electron-builder.yml

  # Install the .deb as an operator would, with Ubuntu's user-namespace
  # restriction on, so the AppArmor profile it installs is what lets
  # Chromium's sandbox start (ADR-607).
  sudo apt-get update
  sudo apt-get install -y xvfb shared-mime-info desktop-file-utils dbus gnome-keyring
  sudo apt-get install -y "./${deb}"
  test "$(readlink -f /usr/bin/kerfdesk)" = /opt/KerfDesk/kerfdesk
  grep -q '^application/x-kerfdesk-project=.*kerfdesk\.desktop' /usr/share/applications/mimeinfo.cache
  sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1
  test "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = 1

  # Linux keeps a licence only under a Secret Service key (licensing-store.ts
  # probes the key Electron actually uses). Launch with an unlocked GNOME Keyring
  # and no desktop name, as on a window manager without GNOME or KDE, so the
  # window (or, while it is held off, Help > Licence) must offer a trial or key,
  # not report a missing keyring. Its own
  # D-Bus session bus, and the keyring on it, end with each launch.
  with_keyring() {
    dbus-run-session -- bash -c '
      set -euo pipefail
      printf %s rehearsal | gnome-keyring-daemon --unlock --components=secrets >/dev/null
      exec env -u XDG_CURRENT_DESKTOP "$@"' with-keyring "$@"
  }
  with_keyring xvfb-run -a pnpm smoke:desktop:native -- /opt/KerfDesk/kerfdesk --expect-licence-window

  # The AppImage as double-clicked: no libfuse2, and its launcher must drop the
  # sandbox by itself where user namespaces are blocked.
  if ldconfig -p | grep -q 'libfuse\.so\.2'; then sudo apt-get remove -y 'libfuse2*'; fi
  if ldconfig -p | grep -q 'libfuse\.so\.2'; then
    echo 'libfuse2 is still installed, so this would not prove the AppImage needs none.' >&2
    exit 1
  fi
  command -v fusermount3 || sudo apt-get install -y fuse3
  with_keyring xvfb-run -a pnpm smoke:desktop:native -- "${appimage}" --expect-licence-window

  sudo apt-get remove -y kerfdesk
  test ! -e /opt/KerfDesk/kerfdesk
  # No modified-app.asar check: Electron 44 enforces ASAR integrity on macOS and
  # Windows only, so there is nothing to prove on Linux (ADR-607 decision 9).
  files=("${deb}" "${appimage}")
fi

digests=''
for file in "${files[@]}"; do
  digests="${digests:+${digests} }$(basename "${file}")=$(sha256 "${file}")"
done
echo "Qualified ${platform} ${arch} files: ${digests}"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "digests=${digests}" >>"${GITHUB_OUTPUT}"; fi
