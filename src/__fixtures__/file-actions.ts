import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type OutputScope,
  type Project,
  type SceneObject,
  type TextObject,
} from '../core/scene';
import type { FileHandle, PlatformAdapter, SaveTarget } from '../platform/types';

const LAYER_COLOR = '#000000';
const MISSING_COLUMN = 'missing-column';
const PRINT_CUT_FAILURE = 'Print-and-Cut registration is not valid.';
export const SAVE_TARGET_NAME = 'failed.gcode';
const TARGET_SEPARATION_MM = 10;
const TEXT_FONT_KEY = 'roboto';
const TEXT_ID = 'variable-text';
const TEXT_LINE_HEIGHT = 1.2;
const TEXT_SIZE_MM = 10;
const VARIABLE_FAILURE = 'This template needs an embedded CSV.';

export function mockPlatform(
  args: {
    readonly open?: () => Promise<ReadonlyArray<FileHandle>>;
    readonly save?: () => Promise<SaveTarget | null>;
  } = {},
): PlatformAdapter {
  return {
    id: 'mock',
    pickFilesForOpen: args.open ?? (async () => []),
    pickFileForSave: args.save ?? (async () => null),
    serial: {
      isSupported: () => false,
      requestPort: async () => null,
    },
  };
}

export function projectWithLine(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: LAYER_COLOR, color: LAYER_COLOR, mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-1',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: LAYER_COLOR,
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

export function projectWithTwoLines(): Project {
  const project = createProject();
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: LAYER_COLOR, color: LAYER_COLOR, mode: 'line' })],
      objects: [lineObject('A', 10), lineObject('B', 120)],
    },
  };
}

export function selectedScope(selectedObjectIds: ReadonlyArray<string>): OutputScope {
  return {
    cutSelectedGraphics: true,
    useSelectionOrigin: false,
    selectedObjectIds,
  };
}

export function reject(message: string): Promise<never> {
  return Promise.reject(new Error(message));
}

export function toasts(): {
  readonly pushToast: (message: string, variant?: string) => void;
  readonly messages: ReadonlyArray<{ readonly message: string; readonly variant?: string }>;
} {
  const messages: Array<{ readonly message: string; readonly variant?: string }> = [];
  return {
    pushToast: (message, variant) => {
      messages.push(variant === undefined ? { message } : { message, variant });
    },
    messages,
  };
}

export type SavePreparationFailureCase = {
  readonly name: string;
  readonly project: () => Project;
  readonly message: string;
};

export const SAVE_PREPARATION_FAILURE_CASES: ReadonlyArray<SavePreparationFailureCase> = [
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

function lineObject(id: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: LAYER_COLOR,
        polylines: [
          {
            closed: false,
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
            ],
          },
        ],
      },
    ],
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
