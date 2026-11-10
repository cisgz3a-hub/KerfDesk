// Rolling audit v13 Y3-P2-1 / Y3-P3-1 (ADR-443 Amendment 3): what the camera
// route says about which way round the sheet lies, which design objects are
// the artwork it checks, and what Job Review says for a Start from that moves
// the cut off the print.

import { describe, expect, it } from 'vitest';
import type { MarkPair } from '../../core/camera/marks/match-mark-pair';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { cameraOrientationNote, designArtworkBoxes, markPairMessage } from './print-cut-camera';
import { collectPrintCutFrameWarnings } from './print-cut-frame-warnings';

const TARGETS = { first: { x: 10, y: 10 }, second: { x: 110, y: 10 } };

function pair(rotationDeg: number, orientation?: MarkPair['orientation']): MarkPair {
  return {
    first: { centre: { x: 0, y: 0 }, sizeMm: 8, offCentreMm: 0 },
    second: { centre: { x: 100, y: 0 }, sizeMm: 8, offCentreMm: 0 },
    scale: 1,
    rotationDeg,
    offsetMm: 1,
    otherPairs: 0,
    ...(orientation === undefined ? {} : { orientation }),
  };
}

function square(id: string, x: number, y: number, size: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: y, maxX: x + size, maxY: y + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y },
              { x: x + size, y },
              { x: x + size, y: y + size },
              { x, y: y + size },
            ],
          },
        ],
      },
    ],
  };
}

describe('the camera route says which way round the sheet lies', () => {
  it('says when the print turned the nearer pairing round, and when it could not tell', () => {
    expect(markPairMessage({ kind: 'found', pair: pair(0, 'print') }, TARGETS)).toContain(
      'confirms which way round the sheet lies',
    );
    expect(markPairMessage({ kind: 'found', pair: pair(180, 'print-flipped') }, TARGETS)).toContain(
      'half a turn off',
    );
    expect(markPairMessage({ kind: 'found', pair: pair(-92, 'ambiguous') }, TARGETS)).toContain(
      'confirm the turn below',
    );
  });

  it('asks for confirmation only when the camera could not tell', () => {
    expect(cameraOrientationNote(pair(-92, 'ambiguous'))).toMatch(
      /reads as turned -92\.0°, but the same two marks also fit a sheet turned 88\.0°/,
    );
    expect(cameraOrientationNote(pair(-92, 'print'))).toBeNull();
    expect(cameraOrientationNote(pair(10, 'nearest'))).toBeNull();
  });

  it('keeps the note until the next capture, which clears it', () => {
    const session = usePrintCutSessionStore.getState();
    session.noteCameraOrientation('check the turn');
    expect(usePrintCutSessionStore.getState().cameraOrientationNote).toBe('check the turn');
    session.capture('first', { x: 1, y: 1 }, 0);
    expect(usePrintCutSessionStore.getState().cameraOrientationNote).toBeNull();
    session.noteCameraOrientation('again');
    session.clear();
    expect(usePrintCutSessionStore.getState().cameraOrientationNote).toBeNull();
  });

  it('checks the artwork beside the marks, not the marks themselves', () => {
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [
          square('mark-1', 6, 6, 8),
          square('mark-2', 106, 6, 8),
          square('artwork', 30, 40, 50),
        ],
      },
    };
    expect(designArtworkBoxes(project, TARGETS)).toEqual([
      { minX: 30, minY: 40, maxX: 80, maxY: 90 },
    ]);
  });
});

describe('Job Review for a Print-and-Cut job from a Start from that moves it (Y3-P3-1)', () => {
  it('says the cut lines up with the print only from Absolute, and why', () => {
    const transform = { scale: 1, rotationRad: 0, translation: { x: 0, y: 0 } };
    const project = { ...createProject(), printAndCutTargets: TARGETS };
    const [warning] = collectPrintCutFrameWarnings(project, transform, {
      startFrom: 'user-origin',
      anchor: 'front-left',
    });
    expect(warning).toContain('Start from is User Origin');
    expect(warning).toContain('lines up with the print only from Absolute Coordinates');
    expect(warning).toContain('moves with the origin, off the print');
  });
});
