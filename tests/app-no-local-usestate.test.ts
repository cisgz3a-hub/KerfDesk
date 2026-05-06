import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appPath = path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx');
const source = fs.readFileSync(appPath, 'utf8');

assert(!/\buseState\b/.test(source), 'T2-6: App.tsx should not import or call React useState');
assert(!/const\s+\[[^\]]+,\s*set[A-Z][^\]]*\]\s*=/.test(source), 'T2-6: App.tsx should not own local React state tuples');
assert(source.includes('useSceneStore'), 'T2-6: scene owner should stay in sceneStore');
assert(source.includes('useSceneHistoryStore'), 'T2-6: history metadata should stay in sceneHistoryStore');
assert(source.includes('useViewportStore'), 'T2-6: viewport shell state should stay in viewportStore');
