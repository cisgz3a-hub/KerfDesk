// Local opt-in source preview; a separate profile preserves installed application data.
import { spawn } from 'node:child_process';
import { mkdir, access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  buildArtcraftPreview,
  ARTCRAFT_REPO_ROOT as root,
  ARTCRAFT_PREVIEW_ROOT as preview,
} from './build-artcraft-preview.mjs';
const editorRoot = path.join(root, '.artcraft');
await access(path.join(editorRoot, 'manifest.json'));
await mkdir(path.join(editorRoot, 'kerfdesk-preview'), { recursive: true });
if (!process.argv.includes('--skip-build')) await buildArtcraftPreview();
const marker = JSON.parse(await readFile(path.join(preview, 'preview-build.json'), 'utf8'));
if (marker.kind !== 'artcraft-source-development-preview')
  throw new Error('Build the source preview before launching it.');
const require = createRequire(import.meta.url);
const env = { ...process.env, KERFDESK_ARTCRAFT_ROOT: editorRoot };
delete env.ELECTRON_RUN_AS_NODE;
delete env.LASERFORGE_DEV_URL;
const child = spawn(
  require('electron'),
  [
    preview,
    '--kerfdesk-native-smoke-user-data=' + path.join(editorRoot, 'kerfdesk-preview'),
    '--kerfdesk-native-smoke-result=' + path.join(editorRoot, 'preview-observation.json'),
    '--kerfdesk-native-smoke-interactive',
  ],
  { cwd: root, detached: true, stdio: 'ignore', windowsHide: true, env },
);
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.unref();
console.log(
  'Opened the isolated KerfDesk source preview. Use Design Studio > Desktop editors. This is a development build, not a release.',
);
