import { describe, expect, it } from 'vitest';
import {
  advanceArcSequence,
  advancePathSequence,
  arcSnapMatchesRadius,
  beginArcSequence,
  beginPathSequence,
  constrainArcTarget,
  constrainPathTarget,
  finishOpenPath,
  pathSequencePreviewPoints,
  updatePointSequence,
} from './design-point-sequence';

const CLOSE_TOLERANCE_MM = 2;

describe('Polyline point sequence', () => {
  it('collects distinct corners without writing intermediate geometry', () => {
    const started = beginPathSequence({ x: 10, y: 10 });
    const advanced = advancePathSequence(
      started,
      { x: 40, y: 10 },
      {
        closeToleranceMm: CLOSE_TOLERANCE_MM,
        hasObjectSnap: false,
      },
    );
    expect(advanced).toEqual({
      kind: 'continue',
      sequence: {
        kind: 'path',
        points: [
          { x: 10, y: 10 },
          { x: 40, y: 10 },
        ],
        pointerMm: { x: 40, y: 10 },
        pointsBeforeLastClick: [{ x: 10, y: 10 }],
      },
    });
  });

  it('closes at the first point without repeating it', () => {
    const sequence = {
      kind: 'path' as const,
      points: [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 40, y: 40 },
      ],
      pointerMm: { x: 40, y: 40 },
    };
    expect(
      advancePathSequence(
        sequence,
        { x: 11, y: 10 },
        {
          closeToleranceMm: CLOSE_TOLERANCE_MM,
          hasObjectSnap: false,
        },
      ),
    ).toEqual({
      kind: 'commit',
      points: sequence.points,
    });
  });

  it('ignores a repeated corner and omits a duplicate preview endpoint', () => {
    const sequence = beginPathSequence({ x: 10, y: 10 });
    expect(
      advancePathSequence(
        sequence,
        { x: 10, y: 10 },
        {
          closeToleranceMm: CLOSE_TOLERANCE_MM,
          hasObjectSnap: false,
        },
      ),
    ).toEqual({
      kind: 'continue',
      sequence,
    });
    expect(pathSequencePreviewPoints(updatePointSequence(sequence, { x: 10, y: 10 }))).toEqual([
      { x: 10, y: 10 },
    ]);
  });

  it('finishes an open path only after two confirmed points', () => {
    const one = beginPathSequence({ x: 10, y: 10 });
    expect(finishOpenPath(one, 'p')).toBeNull();
    const two = advancePathSequence(
      one,
      { x: 40, y: 10 },
      {
        closeToleranceMm: CLOSE_TOLERANCE_MM,
        hasObjectSnap: false,
      },
    );
    if (two.kind !== 'continue') throw new Error('expected a live sequence');
    expect(finishOpenPath(two.sequence, 'p')).toEqual({
      kind: 'path',
      id: 'p',
      points: [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
      ],
      closed: false,
    });
  });

  it('drops only the second constituent click when a double-click drifts', () => {
    const sequence = {
      kind: 'path' as const,
      points: [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 40, y: 40 },
        { x: 41, y: 41 },
      ],
      pointerMm: { x: 41, y: 41 },
      pointsBeforeLastClick: [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 40, y: 40 },
      ],
    };
    expect(finishOpenPath(sequence, 'p', { discardLastClick: true })?.points).toEqual([
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
    ]);
  });

  it('applies Ortho from the last point while object snap wins', () => {
    const sequence = {
      kind: 'path' as const,
      points: [
        { x: 10, y: 10 },
        { x: 40, y: 20 },
      ],
      pointerMm: { x: 40, y: 20 },
    };
    expect(
      constrainPathTarget(
        sequence,
        { x: 70, y: 25 },
        {
          orthoEnabled: true,
          hasObjectSnap: false,
          closeToleranceMm: 1,
        },
      ),
    ).toEqual({
      x: 70,
      y: 20,
    });
    expect(
      constrainPathTarget(
        sequence,
        { x: 70, y: 25 },
        {
          orthoEnabled: true,
          hasObjectSnap: true,
          closeToleranceMm: 1,
        },
      ),
    ).toEqual({
      x: 70,
      y: 25,
    });
  });

  it('preserves the close target when Ortho is enabled', () => {
    const sequence = {
      kind: 'path' as const,
      points: [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 40, y: 40 },
      ],
      pointerMm: { x: 40, y: 40 },
    };
    expect(
      constrainPathTarget(
        sequence,
        { x: 11, y: 10 },
        {
          orthoEnabled: true,
          hasObjectSnap: false,
          closeToleranceMm: 2,
        },
      ),
    ).toEqual({
      x: 10,
      y: 10,
    });
  });

  it('previews the exact closing edge without overriding a distinct object snap', () => {
    const sequence = {
      kind: 'path' as const,
      points: [
        { x: 10, y: 10 },
        { x: 40, y: 10 },
        { x: 40, y: 40 },
      ],
      pointerMm: { x: 40, y: 40 },
    };
    expect(
      constrainPathTarget(
        sequence,
        { x: 11, y: 10 },
        {
          orthoEnabled: false,
          hasObjectSnap: false,
          closeToleranceMm: 2,
        },
      ),
    ).toEqual({
      x: 10,
      y: 10,
    });
    const snapped = constrainPathTarget(
      sequence,
      { x: 11, y: 10 },
      {
        orthoEnabled: false,
        hasObjectSnap: true,
        closeToleranceMm: 2,
      },
    );
    expect(snapped).toEqual({ x: 11, y: 10 });
    expect(
      advancePathSequence(sequence, snapped, { closeToleranceMm: 2, hasObjectSnap: true }).kind,
    ).toBe('continue');
    const nearlyCoincidentSnap = constrainPathTarget(
      sequence,
      { x: 10.005, y: 10 },
      {
        orthoEnabled: false,
        hasObjectSnap: true,
        closeToleranceMm: 2,
      },
    );
    expect(nearlyCoincidentSnap).toEqual({ x: 10.005, y: 10 });
    expect(
      advancePathSequence(sequence, nearlyCoincidentSnap, {
        closeToleranceMm: 2,
        hasObjectSnap: true,
      }).kind,
    ).toBe('continue');
  });
});

describe('Arc point sequence', () => {
  it('turns centre, start, and end into a fixed-radius positive sweep', () => {
    const centred = beginArcSequence({ x: 10, y: 10 });
    const started = advanceArcSequence(centred, { x: 20, y: 10 });
    if (started.kind !== 'continue') throw new Error('expected a live Arc');
    expect(advanceArcSequence(started.sequence, { x: 10, y: 20 })).toEqual({
      kind: 'commit',
      geometry: {
        kind: 'arc',
        center: { x: 10, y: 10 },
        radiusMm: 10,
        startAngleDeg: 0,
        sweepDeg: 90,
      },
    });
  });

  it('normalizes a sweep that crosses zero degrees', () => {
    const sequence = {
      kind: 'arc' as const,
      centerMm: { x: 0, y: 0 },
      startMm: { x: 0, y: -10 },
      pointerMm: { x: 0, y: -10 },
    };
    const finished = advanceArcSequence(sequence, { x: 10, y: 0 });
    expect(finished.kind === 'commit' ? finished.geometry.sweepDeg : null).toBe(90);
  });

  it('keeps a degenerate radius or sweep live without committing', () => {
    const centred = beginArcSequence({ x: 10, y: 10 });
    expect(advanceArcSequence(centred, { x: 10, y: 10 }).kind).toBe('continue');
    const started = advanceArcSequence(centred, { x: 20, y: 10 });
    if (started.kind !== 'continue') throw new Error('expected a live Arc');
    expect(advanceArcSequence(started.sequence, { x: 20, y: 10 }).kind).toBe('continue');
  });

  it('does not reuse the previous preview when the Arc end is clicked at the centre', () => {
    const sequence = {
      kind: 'arc' as const,
      centerMm: { x: 0, y: 0 },
      startMm: { x: 10, y: 0 },
      pointerMm: { x: 0, y: 10 },
    };
    const target = constrainArcTarget(
      sequence,
      { x: 0, y: 0 },
      {
        orthoEnabled: false,
        hasObjectSnap: false,
      },
    );

    expect(target).toEqual({ x: 0, y: 0 });
    expect(advanceArcSequence(sequence, target)).toEqual({
      kind: 'continue',
      sequence: { ...sequence, pointerMm: { x: 0, y: 0 } },
    });
  });

  it('projects the end onto the established radius after Ortho', () => {
    const sequence = {
      kind: 'arc' as const,
      centerMm: { x: 10, y: 10 },
      startMm: { x: 30, y: 10 },
      pointerMm: { x: 30, y: 10 },
    };
    expect(
      constrainArcTarget(
        sequence,
        { x: 13, y: 40 },
        {
          orthoEnabled: true,
          hasObjectSnap: false,
        },
      ),
    ).toEqual({
      x: 10,
      y: 30,
    });
    const snapped = constrainArcTarget(
      sequence,
      { x: 22, y: 26 },
      {
        orthoEnabled: true,
        hasObjectSnap: true,
      },
    );
    expect(Math.hypot(snapped.x - 10, snapped.y - 10)).toBeCloseTo(20, 8);
    expect(snapped.x).toBeGreaterThan(10);
  });

  it('accepts an Arc endpoint snap only when it lies on the fixed radius', () => {
    const sequence = {
      kind: 'arc' as const,
      centerMm: { x: 10, y: 10 },
      startMm: { x: 30, y: 10 },
      pointerMm: { x: 30, y: 10 },
    };
    expect(arcSnapMatchesRadius(sequence, { x: 10, y: 30 })).toBe(true);
    expect(arcSnapMatchesRadius(sequence, { x: 10, y: 30.009 })).toBe(false);
    expect(arcSnapMatchesRadius(sequence, { x: 10, y: 40 })).toBe(false);
  });
});
