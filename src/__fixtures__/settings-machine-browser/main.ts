// Manual browser fixture for the settings audit. Loads known synthetic artwork
// before mounting the real application; the operator uses ordinary UI controls.
// The production entry point never imports this fixture. No hardware is invoked.
import { deserializeProjectValue } from '../../io/project';
import { useStore } from '../../ui/state';
import f0 from './f0.json';
import mixed from './mixed.json';

const fixture = new URLSearchParams(window.location.search).get('fixture');
const parsed = deserializeProjectValue(fixture === 'f0' ? f0 : mixed);
if (parsed.kind !== 'ok') throw new Error(`Invalid browser fixture: ${JSON.stringify(parsed)}`);
useStore.getState().setProject(parsed.project);
useStore.getState().selectAllObjects();
await import('../../ui/app/main');
