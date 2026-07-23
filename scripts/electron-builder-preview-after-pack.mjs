import fs from 'node:fs';
import path from 'node:path';

const ELECTRON_RUNTIME_NOTICE_FILES = [
  ['LICENSE', path.join('legal', 'electron', 'LICENSE')],
  ['LICENSES.chromium.html', path.join('legal', 'electron', 'LICENSES.chromium.html')],
];

export default async function copyPreviewRuntimeNotices(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appBundleName = fs.readdirSync(context.appOutDir).find((entry) => entry.endsWith('.app'));

  if (!appBundleName) {
    throw new Error(`Missing macOS .app bundle in ${context.appOutDir}`);
  }

  const resourcesDir = path.join(context.appOutDir, appBundleName, 'Contents', 'Resources');

  for (const [sourceName, targetRelativePath] of ELECTRON_RUNTIME_NOTICE_FILES) {
    const sourcePath = path.join(context.appOutDir, sourceName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Missing Electron runtime notice source: ${sourcePath}`);
    }

    const targetPath = path.join(resourcesDir, targetRelativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}
