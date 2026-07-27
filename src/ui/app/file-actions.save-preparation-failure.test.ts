import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { handleSaveGcode } from './file-actions';

const LAYER_COLOR = '#000000';
const MISSING_COLUMN = 'missing-column';
const PRINT_CUT_FAILURE = 'Print-and-Cut registration is not valid.';
const SAVE_TARGET_NAME = 'failed.gcode';
const TARGET_SEPARATION_MM = 10;
const TEXT_FONT_KEY = 'roboto';
const TEXT_ID = 'variable-text';
const TEXT_LINE_HEIGHT = 1.2;
const TEXT_SIZE_MM = 10;
const VARIABLE_FAILURE = 'This template needs an embedded CSV.';

type FailureCase = {
  readonly name: string;
  readonly project: () => Project;
  readonly message: string;
};

const FAILURE_CASES: ReadonlyArray<FailureCase> = [
  {
    name: 'stale Print-and-Cut registration',
    project: projectWithStalePrintCutRegistration,
    message: PRINT_CUT_FAILURE,
  },
  {
    name: 'missing variable data',
    project: projectWithMissingVariableData,
    message: VARIABLE_FAILURE,
  },
];

describe('handleSaveGcode preparation failures', () => {
  beforeEach(() => {
    useExperimentalLaserFeatures.getState().resetFeatures();
    useExperimentalLaserFeatures.getState().setFeature('printAndCut', true);
    usePrintCutSessionStore.getState().clear();
  });

  afterEach(() => {
    usePrintCutSessionStore.getState().clear();
    useExperimentalLaserFeatures.getState().resetFeatures();
    vi.restoreAllMocks();
  });

  it.each(FAILURE_CASES)(
    'does not create an empty successful export for $name',
    async ({ project, message }) => {
      const write = vi.fn(async () => undefined);
      const target: SaveTarget = { displayName: SAVE_TARGET_NAME, write };
      const pickFileForSave = vi.fn(async () => target);
      const advanceVariablesAfter = vi.fn();
      const toasts: Array<{ readonly message: string; readonly variant?: string }> = [];
      const alert = vi.spyOn(window, 'alert').mockReturnValue(undefined);

      await handleSaveGcode({
        platform: platformWithSave(pickFileForSave),
        project: project(),
        savedName: null,
        advanceVariablesAfter,
        pushToast: (toastMessage, variant) => {
          toasts.push(
            variant === undefined ? { message: toastMessage } : { message: toastMessage, variant },
          );
        },
      });

      expect(pickFileForSave).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(advanceVariablesAfter).not.toHaveBeenCalled();
      expect(toasts.some((toast) => toast.variant === 'success')).toBe(false);
      expect(alert).toHaveBeenCalledOnce();
      expect(alert.mock.calls[0]?.[0]).toContain(message);
    },
  );
});

function platformWithSave(save: PlatformAdapter['pickFileForSave']): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: save,
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

function projectWithStalePrintCutRegistration(): Project {
  return {
    ...createProject(),
    printAndCutTargets: {
      first: { x: 0, y: 0 },
      second: { x: TARGET_SEPARATION_MM, y: 0 },
    },
  };
}

function projectWithMissingVariableData(): Project {
  const project = createProject();
  const text: TextObject = {
    kind: 'text',
    id: TEXT_ID,
    content: '',
    variableTemplate: { tokens: [{ kind: 'csv', column: MISSING_COLUMN }] },
    fontKey: TEXT_FONT_KEY,
    sizeMm: TEXT_SIZE_MM,
    alignment: 'left',
    lineHeight: TEXT_LINE_HEIGHT,
    letterSpacing: 0,
    color: LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: LAYER_COLOR, color: LAYER_COLOR, mode: 'line' })],
      objects: [text],
    },
  };
}
