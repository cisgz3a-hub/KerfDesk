import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Project,
} from '../../core/scene';
import type { PlatformAdapter } from '../../platform/types';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
import { operationProFeature } from '../licensing/pro-operation-policy';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { personalArtworkActions } from './personal-artwork-actions';
import {
  parsePersonalArtworkLibrary,
  serializePersonalArtworkLibrary,
} from './personal-artwork-format';
import { capturePersonalArtwork, type PersonalArtwork } from './personal-artwork-model';
import type { PersonalArtworkRepository } from './personal-artwork-storage';
import { artworkProject } from './personal-artwork-test-fixtures';

// Rolling audit v2, 02-P2-1: Insert wrote through zustand's raw setter, so
// saved or hand-edited V-carve artwork landed in Free without asking for Pro.

let onAllowed: (() => void) | undefined;
const requestPro = vi.fn((_feature: string, callback?: () => void) => {
  onAllowed = callback;
  return false;
});
const FREE = { ...UNRESTRICTED_EDITION, licensed: true, pro: false, requestPro };
const onClose = vi.fn();
const onError = vi.fn();

beforeEach(() => {
  resetStore();
  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed = undefined;
  vi.clearAllMocks();
});
afterEach(() => {
  resetStore();
  setActiveEdition(null);
});

function withEngraveCutType(project: Project, cutType: 'v-carve' | 'profile-on-path'): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) =>
        layer.id === 'engrave'
          ? { ...layer, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType } }
          : layer,
      ),
    },
  };
}

async function savedArtwork(cutType: 'v-carve' | 'profile-on-path'): Promise<PersonalArtwork> {
  useStore.setState({
    project: withEngraveCutType(artworkProject(), cutType),
    selectedObjectId: 'text',
    additionalSelectedIds: new Set(),
  });
  return capturePersonalArtwork(useStore.getState(), 'Sign', '');
}

/** The `.lfart` route: export, change the operation by hand, import. */
function editedToVCarve(entry: PersonalArtwork): PersonalArtwork {
  const project = JSON.parse(entry.projectJson) as {
    scene: { layers: Array<{ cnc?: { cutType: string } }> };
  };
  for (const layer of project.scene.layers) {
    if (layer.cnc !== undefined) layer.cnc.cutType = 'v-carve';
  }
  const [imported] = parsePersonalArtworkLibrary(
    serializePersonalArtworkLibrary([{ ...entry, projectJson: JSON.stringify(project) }]),
  );
  if (imported === undefined) throw new Error('The edited library did not import');
  return imported;
}

function openFreeCncProject(): Project {
  const project = { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG };
  useStore.setState({ project, undoStack: [], redoStack: [] });
  setActiveEdition(FREE);
  return project;
}

function insert(entry: PersonalArtwork): void {
  personalArtworkActions(
    {} as PlatformAdapter,
    {} as PersonalArtworkRepository,
    async () => undefined,
    onClose,
    onError,
  ).insert(entry);
}

const proOperations = () =>
  useStore.getState().project.scene.layers.filter((layer) => operationProFeature(layer) !== null);

it.each([
  ['saved V-carve artwork', () => savedArtwork('v-carve')],
  ['a hand-edited .lfart', async () => editedToVCarve(await savedArtwork('profile-on-path'))],
])('asks for Pro before inserting %s in Free, then inserts once unlocked', async (_name, make) => {
  const entry = await make();
  const before = openFreeCncProject();

  insert(entry);

  expect(requestPro).toHaveBeenCalledExactlyOnceWith('vcarve', expect.any(Function));
  expect(useStore.getState().project).toBe(before);
  expect(useStore.getState().undoStack).toEqual([]);
  expect(onClose).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();

  setActiveEdition(UNRESTRICTED_EDITION);
  onAllowed?.();
  expect(proOperations().map((layer) => layer.cnc?.cutType)).toEqual(['v-carve']);
  expect(useStore.getState().undoStack).toEqual([before]);
  expect(onClose).toHaveBeenCalledOnce();
});

it('inserts artwork on Free operations at once without asking', async () => {
  const entry = await savedArtwork('profile-on-path');
  const before = openFreeCncProject();

  insert(entry);

  expect(requestPro).not.toHaveBeenCalled();
  expect(useStore.getState().project).not.toBe(before);
  expect(proOperations()).toEqual([]);
  expect(onClose).toHaveBeenCalledOnce();
});
