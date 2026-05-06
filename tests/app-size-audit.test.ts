import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appPath = path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx');
const appLineCount = fs.readFileSync(appPath, 'utf8').split(/\r?\n/).length;

assert(
  appLineCount <= 2000,
  `T2-6 App.tsx size guard: expected <= 2000 lines after Phase 3 split, got ${appLineCount}`,
);
