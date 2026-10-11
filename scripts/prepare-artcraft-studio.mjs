// Install pinned, unmodified full editors for the desktop integration prototype.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, rename, stat, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.artcraft');
const releases = [
  {
    id: 'photo',
    repo: 'photocraft',
    version: '0.7.0',
    executableSha256: 'dca47bc19136e8d4849e03525f53accd23413a6727704f3b0ba8bd044af2b6da',
    sha256: '331e3111ed068b3f41df7d44401c3b51a312abde393e5829a4f24df2c9405b87',
  },
  {
    id: 'vector',
    repo: 'vectorcraft',
    version: '0.9.0',
    executableSha256: '6358fce5057af01e12d18f148b7a7237c97013892197aa8cb18af1b921b0b7a5',
    sha256: '474028c71d2ef045230d80e037cfe7e8745eeecd1a034412559e170859bb09ec',
  },
];

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function exists(file) {
  return stat(file).then(
    () => true,
    () => false,
  );
}

async function findExecutable(directory, name) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name) return full;
    if (entry.isDirectory()) {
      const found = await findExecutable(full, name);
      if (found) return found;
    }
  }
  return null;
}

function extract(archive, destination) {
  // Validate every zip entry before extraction. Never overwrite an existing tree.
  const command = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $target = [IO.Path]::GetFullPath($env:KERFDESK_EXTRACT_TARGET)
    $prefix = $target.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $zip = [IO.Compression.ZipFile]::OpenRead($env:KERFDESK_EXTRACT_ARCHIVE)
    try {
      foreach ($entry in $zip.Entries) {
        $full = [IO.Path]::GetFullPath([IO.Path]::Combine($target, $entry.FullName))
        if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive entry' }
      }
    } finally { $zip.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($env:KERFDESK_EXTRACT_ARCHIVE, $target)
  `;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    {
      windowsHide: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        KERFDESK_EXTRACT_ARCHIVE: archive,
        KERFDESK_EXTRACT_TARGET: destination,
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Archive extraction failed');
}

async function install(release) {
  const name = `${release.repo}-${release.version}-windows-x64-portable.zip`;
  const url = `https://github.com/storytold/${release.repo}/releases/download/v${release.version}/${name}`;
  const archive = path.join(root, name);
  const directory = path.join(root, `${release.repo}-${release.version}`);
  if (!(await exists(archive))) {
    console.log(`Downloading ${release.repo} ${release.version}…`);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
    const temporary = `${archive}.${randomUUID()}.partial`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
    if ((await sha256(temporary)) !== release.sha256)
      throw new Error('Downloaded archive checksum mismatch');
    await rename(temporary, archive);
  }
  if ((await sha256(archive)) !== release.sha256) throw new Error(`Checksum mismatch: ${name}`);
  if (!(await exists(directory))) {
    const staging = `${directory}.${randomUUID()}.staging`;
    extract(archive, staging);
    await rename(staging, directory);
  }
  const executable = await findExecutable(directory, `${release.repo}.exe`);
  if (!executable) throw new Error(`Missing ${release.repo}.exe`);
  if ((await sha256(executable)) !== release.executableSha256)
    throw new Error('Installed executable checksum mismatch');
  return {
    id: release.id,
    version: release.version,
    executable: path.relative(root, executable),
    executableSha256: await sha256(executable),
    archiveSha256: release.sha256,
    source: url,
  };
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('This prototype installer supports Windows x64.');
}
await mkdir(root, { recursive: true });
const editors = [];
for (const release of releases) editors.push(await install(release));
const manifest = { schema: 1, editors };
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `Full editors installed in ${root}\nSet KERFDESK_ARTCRAFT_ROOT to this directory before starting KerfDesk.`,
);
