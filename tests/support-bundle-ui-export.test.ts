import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('\n=== Support bundle UI export wiring ===\n');

const root = process.cwd();
const modalSrc = fs.readFileSync(path.join(root, 'src/ui/components/AppSettingsModal.tsx'), 'utf8');
const exportSrc = fs.readFileSync(path.join(root, 'src/diagnostics/SupportBundleExport.ts'), 'utf8');
const bundleSrc = fs.readFileSync(path.join(root, 'src/diagnostics/SupportBundle.ts'), 'utf8');
const preloadSrc = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const mainSrc = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const typesSrc = fs.readFileSync(path.join(root, 'src/types/web-serial.d.ts'), 'utf8');

assert(/Export Diagnostic Bundle/.test(modalSrc),
  'Settings/About exposes an Export Diagnostic Bundle action');
assert(/exportRuntimeSupportBundle/.test(modalSrc),
  'AppSettingsModal calls the runtime support-bundle exporter');
assert(/Support bundle saved/.test(modalSrc) && /Support bundle export failed/.test(modalSrc),
  'AppSettingsModal surfaces success and failure states');

assert(/export async function buildRuntimeSupportBundle/.test(exportSrc),
  'runtime bundle collector is exported');
assert(/export async function saveSupportBundleZip/.test(exportSrc),
  'ZIP save helper is exported');
assert(/buildSupportBundleZip/.test(exportSrc),
  'export path creates a real ZIP archive before saving');

assert(!/ZIP packaging[\s\S]{0,80}deferred/i.test(bundleSrc),
  'SupportBundle.ts no longer documents ZIP packaging as deferred');
assert(!/Help [^\\n]* UI is filed as T2-108-followup/i.test(bundleSrc),
  'SupportBundle.ts no longer documents the UI export path as deferred');

assert(/saveBinaryFile/.test(preloadSrc),
  'preload exposes binary save IPC for ZIP exports');
assert(/ipcMain\.handle\('dialog:saveBinary'/.test(mainSrc),
  'main process handles binary save dialog');
assert(/Buffer\.from\(base64Content, 'base64'\)/.test(mainSrc),
  'main process writes ZIP bytes from base64 rather than UTF-8 text');
assert(/saveBinaryFile\?: \(defaultName: string, base64Content: string\) => Promise<boolean>/.test(typesSrc),
  'global ElectronAPI type declares saveBinaryFile');

console.log('Support bundle UI export wiring tests passed.');
