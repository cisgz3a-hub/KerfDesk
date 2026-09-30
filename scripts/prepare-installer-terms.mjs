import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** NSIS treats unmarked LicenseData as ANSI, even for a Unicode installer. */
export function encodeInstallerTerms(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (bytes.length > 262_144 || !text.trim() || text.includes('\0'))
    throw new Error('Installer terms must contain bounded, nonempty UTF-8 text.');
  // Add only an encoding marker. Preserve wording, punctuation and line endings.
  return bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)
    ? bytes
    : Buffer.concat([UTF8_BOM, bytes]);
}

export async function prepareInstallerTerms(root = ROOT) {
  const target = resolve(root, 'build/installer-terms.txt');
  const encoded = encodeInstallerTerms(await readFile(resolve(root, 'public/eula.txt')));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, encoded);
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await prepareInstallerTerms();
