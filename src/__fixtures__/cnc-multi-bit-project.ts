// A small multi-bit CNC project for the bit-change suites (annoyance audit A2
// B4-P1-1, ADR-416 Amendment 4): one shallow straight line per operation, each
// operation on its own bit, so the compiled job has one M0 hold per bit after
// the first. Plain data: the Vitest simulator suite and the Playwright spec
// both build their job from it.

import { DEFAULT_DEVICE_PROFILE } from '../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../core/scene';

/** The starter bit library's name for a bit id. */
export function starterBitName(toolId: string): string {
  const tool = DEFAULT_CNC_MACHINE_CONFIG.tools.find((entry) => entry.id === toolId);
  if (tool === undefined) throw new Error(`Unknown starter bit: ${toolId}`);
  return tool.name;
}

// Scene-data colours for each operation's artwork, not application chrome.
function strokeColor(index: number): string {
  return `#${(index + 1).toString(16).padStart(2, '0')}0000`;
}

function stroke(index: number): SceneObject {
  const y = 10 + index * 10;
  return {
    kind: 'imported-svg',
    id: `stroke-${index}`,
    source: `stroke-${index}.svg`,
    bounds: { minX: 10, minY: y, maxX: 40, maxY: y },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: strokeColor(index),
        polylines: [
          {
            closed: false,
            points: [
              { x: 10, y },
              { x: 40, y },
            ],
          },
        ],
      },
    ],
  };
}

/** A CNC project with one line per bit, cut in the given order. Its Default
 * bit stays the starter 3.175 mm end mill whatever bits the job uses. */
export function multiBitCncProject(toolIds: ReadonlyArray<string>): Project {
  return {
    ...createProject(DEFAULT_DEVICE_PROFILE),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...EMPTY_SCENE,
      objects: toolIds.map((_, index) => stroke(index)),
      layers: toolIds.map((toolId, index) => ({
        ...createLayer({ id: `operation-${index}`, color: strokeColor(index) }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 1, depthPerPassMm: 1, toolId },
      })),
    },
  };
}
