import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const storeSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'stores', 'sceneHistoryStore.ts'), 'utf8');

assert(!appSource.includes('../history/HistoryManager'), 'App.tsx should not import HistoryManager directly');
assert(!appSource.includes('new HistoryManager'), 'App.tsx should not construct HistoryManager');
assert(!appSource.includes('historyRef'), 'App.tsx should not keep a local historyRef');

assert(storeSource.includes('../history/HistoryManager'), 'sceneHistoryStore owns the HistoryManager dependency');
assert(storeSource.includes('pushHistory'), 'sceneHistoryStore exposes pushHistory');
assert(storeSource.includes('resetHistory'), 'sceneHistoryStore exposes resetHistory');
assert(storeSource.includes('undoHistoryEntry'), 'sceneHistoryStore exposes undoHistoryEntry');
assert(storeSource.includes('redoHistoryEntry'), 'sceneHistoryStore exposes redoHistoryEntry');
