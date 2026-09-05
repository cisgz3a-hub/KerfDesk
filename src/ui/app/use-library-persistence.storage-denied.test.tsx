import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  CNC_LIBRARY_PERSIST_FAILURE_MESSAGE,
  useCncLibraryPersistence,
} from './use-cnc-library-persistence';
import {
  LAYER_DEFAULTS_PERSIST_FAILURE_MESSAGE,
  useLayerDefaultsPersistence,
} from './use-layer-defaults-persistence';
import {
  MATERIAL_LIBRARY_PERSIST_FAILURE_MESSAGE,
  useMaterialLibraryPersistence,
} from './use-material-library-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  resetStore();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

const cases = [
  {
    name: 'CNC library',
    hook: useCncLibraryPersistence,
    message: CNC_LIBRARY_PERSIST_FAILURE_MESSAGE,
    edit: () => {
      const library = {
        ...useStore.getState().cncLibrary,
        feedPresets: [
          {
            id: 'session-preset',
            name: 'Session preset',
            feedMmPerMin: 500,
            plungeMmPerMin: 100,
            spindleRpm: 10000,
            depthPerPassMm: 1,
            stepoverPercent: 40,
          },
        ],
      };
      useStore.getState().setCncLibrary(library);
      expect(useStore.getState().cncLibrary).toBe(library);
    },
  },
  {
    name: 'layer defaults',
    hook: useLayerDefaultsPersistence,
    message: LAYER_DEFAULTS_PERSIST_FAILURE_MESSAGE,
    edit: () => {
      const defaults = { byColor: {}, allColors: { power: 42 } };
      useStore.getState().setLayerDefaults(defaults);
      expect(useStore.getState().layerDefaults).toEqual(defaults);
    },
  },
  {
    name: 'material library',
    hook: useMaterialLibraryPersistence,
    message: MATERIAL_LIBRARY_PERSIST_FAILURE_MESSAGE,
    edit: () => {
      const saved = { ...useStore.getState().savedLibraries };
      useStore.setState({ savedLibraries: saved });
      expect(useStore.getState().savedLibraries).toBe(saved);
    },
  },
];

describe('library persistence when the browser denies storage', () => {
  it.each(cases)(
    '$name keeps session edits and warns only once',
    async ({ hook, message, edit }) => {
      vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
        throw new DOMException('Storage is blocked', 'SecurityError');
      });
      function Probe(): null {
        hook();
        return null;
      }
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(<Probe />));
        expect(useToastStore.getState().toasts).toHaveLength(0);
        await act(async () => {
          edit();
          edit();
        });
        expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([message]);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});
