import fs from 'node:fs';
import { createWriteStream } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ELECTRON_RUNTIME_NOTICE_FILES = [
  ['LICENSE', path.join('legal', 'electron', 'LICENSE')],
  ['LICENSES.chromium.html', path.join('legal', 'electron', 'LICENSES.chromium.html')],
];

const electronPackagePath = require.resolve('electron/package.json');
const electronPackage = JSON.parse(fs.readFileSync(electronPackagePath, 'utf8'));
const electronPackageDir = path.dirname(electronPackagePath);

function electronArchName(context) {
  if (String(context.arch) === 'arm64' || String(context.arch) === '3') {
    return 'arm64';
  }

  if (context.appOutDir.includes('arm64')) {
    return 'arm64';
  }

  return 'x64';
}

function localNoticePath(sourceName) {
  const candidates = [
    path.join(electronPackageDir, 'dist', sourceName),
    path.join(electronPackageDir, sourceName),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function downloadFile(url, targetPath) {
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        downloadFile(response.headers.location, targetPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(targetPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function extractElectronZipNotice(context, sourceName) {
  const version = electronPackage.version;
  const arch = electronArchName(context);
  const zipName = `electron-v${version}-darwin-${arch}.zip`;
  const zipPath = path.join(os.tmpdir(), zipName);
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), `kerfdesk-electron-notices-${arch}-`));
  const extractedNoticePath = path.join(extractDir, sourceName);

  if (!fs.existsSync(zipPath) || fs.statSync(zipPath).size === 0) {
    await downloadFile(
      `https://github.com/electron/electron/releases/download/v${version}/${zipName}`,
      zipPath,
    );
  }

  execFileSync('ditto', ['-x', '-k', zipPath, extractDir], { stdio: 'ignore' });

  if (!fs.existsSync(extractedNoticePath)) {
    throw new Error(`Missing Electron runtime notice ${sourceName} in ${zipName}`);
  }

  return extractedNoticePath;
}

async function resolveNoticePath(context, sourceName) {
  const localPath = localNoticePath(sourceName);
  if (localPath) {
    return localPath;
  }

  return extractElectronZipNotice(context, sourceName);
}

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
    const sourcePath = await resolveNoticePath(context, sourceName);
    const targetPath = path.join(resourcesDir, targetRelativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}
