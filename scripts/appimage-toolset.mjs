// electron-builder artifactBuildStarted hook: the Linux AppImage is built from a
// copy of electron-builder's own AppImage toolset without the libraries KerfDesk
// does not ship (ADR-017 Amendment 2).
//
// electron-builder 26.17.0 copies the toolset's whole lib/<arch> folder into the
// AppImage's usr/lib (app-builder-lib out/targets/appimage/appImageUtil.js,
// buildStaticRuntimeAppImage) and has no setting to leave a library out. It looks
// the toolset up after this event and takes it from APPIMAGE_TOOLS_PATH when that
// is set (out/toolsets/linux.js, getAppImageTools). So this hook asks
// electron-builder for the toolset it would use, which it downloads and checks
// against its pinned SHA-256, copies it without those libraries and points
// APPIMAGE_TOOLS_PATH at the copy. Nothing in the toolset is run here.

import { rmSync } from 'node:fs';
import { cp, mkdtemp, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// The static-runtime toolset electron-builder.yml and electron-builder.preview.yml pin.
export const APPIMAGE_TOOLSET = '1.0.3';

// libappindicator3 and libindicator3 hold GPL-3.0 code and show a tray icon;
// KerfDesk has none (electron/ never creates a Tray). GConf is an old GNOME
// settings store KerfDesk does not use. verify-linux-package.sh checks that
// nothing in the AppImage links any of them.
export const LEFT_OUT_LIBRARIES = [
  'libappindicator3.so.1',
  'libindicator3.so.7',
  'libgconf-2.so.4',
];

export function isLeftOutLibrary(name) {
  return LEFT_OUT_LIBRARIES.some((soname) => name === soname || name.startsWith(`${soname}.`));
}

// Copies the toolset folder, symbolic links as they are, without the left-out
// libraries in any lib/<arch> folder. Returns what it left out.
export async function copyToolsetWithoutLeftOutLibraries(source, target) {
  const leftOut = [];
  await cp(source, target, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (entry) => {
      const parts = path.relative(source, entry).split(path.sep);
      const drop = parts.length === 3 && parts[0] === 'lib' && isLeftOutLibrary(parts[2]);
      if (drop) leftOut.push(parts.join('/'));
      return !drop;
    },
  });
  return leftOut.sort();
}

function electronBuilderAppImageTools() {
  const requireBuilder = createRequire(import.meta.resolve('electron-builder'));
  return requireBuilder('app-builder-lib/out/toolsets/linux.js').getAppImageTools;
}

export async function prepareAppImageToolset(event, getAppImageTools) {
  if (event.targetPresentableName !== 'AppImage') return null;
  const tools = await (getAppImageTools ?? electronBuilderAppImageTools())(
    APPIMAGE_TOOLSET,
    event.arch,
  );
  const source = path.dirname(tools.mksquashfs);
  const libraries = path.relative(source, tools.runtimeLibraries);
  if (libraries.split(path.sep).length !== 2 || !libraries.startsWith(`lib${path.sep}`)) {
    throw new Error(`The AppImage toolset's libraries are not in lib/<arch>: ${libraries}`);
  }
  const target = await mkdtemp(path.join(os.tmpdir(), 'kerfdesk-appimage-toolset-'));
  process.once('exit', () => rmSync(target, { recursive: true, force: true }));
  const leftOut = await copyToolsetWithoutLeftOutLibraries(source, target);
  const shipped = (await readdir(path.join(target, libraries))).sort();
  const leftOutHere = leftOut
    .filter((entry) => path.posix.dirname(entry) === libraries.split(path.sep).join('/'))
    .map((entry) => path.posix.basename(entry));
  process.env.APPIMAGE_TOOLS_PATH = target;
  console.log(
    `  • AppImage toolset ${APPIMAGE_TOOLSET}: usr/lib leaves out ` +
      `${leftOutHere.join(' ') || 'nothing'} and gets ${shipped.join(' ')}`,
  );
  return { target, leftOut, shipped };
}

export default async function artifactBuildStarted(event) {
  await prepareAppImageToolset(event);
}
