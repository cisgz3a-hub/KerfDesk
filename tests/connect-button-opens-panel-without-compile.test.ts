import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = readFileSync(resolve(process.cwd(), 'src/ui/components/App.tsx'), 'utf-8');
const match = appSource.match(
  /const handleConnect = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[([^\]]*)\]\);/,
);

assert(match, 'App.tsx exposes handleConnect as an async useCallback');

const body = match?.[1] ?? '';
const deps = match?.[2] ?? '';

assert(
  /dialogs\.setShowConnection\(true\);/.test(body),
  'Connect opens the connection panel',
);
assert(
  !/compileGcode\s*\(/.test(body),
  'Connect does not compile G-code',
);
assert(
  !/showAlert\('No Objects'/.test(body),
  'Connect does not show an empty-canvas No Objects alert',
);
assert(
  !/setCurrentGcode\s*\(/.test(body),
  'Connect does not mutate the current compiled G-code',
);
assert(
  !/\bscene\b/.test(deps) && !/\bcompileGcode\b/.test(deps) && !/\bshowAlert\b/.test(deps),
  'Connect callback dependencies are not tied to scene compilation',
);
