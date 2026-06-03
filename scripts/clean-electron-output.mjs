import { rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const outputDir = resolve('dist-electron');

if (basename(outputDir) !== 'dist-electron') {
  throw new Error(`Refusing to clean unexpected Electron output path: ${outputDir}`);
}

rmSync(outputDir, { recursive: true, force: true });
