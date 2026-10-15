import { describe, expect, it } from 'vitest';
import { createProject, type Project } from '../scene';
import {
  applySimilarityPoint,
  applySimilarityProject,
  invertSimilarity,
  solveTwoPointRegistration,
} from './similarity-transform';

describe('two-point similarity registration', () => {
  it.each([NaN, Infinity, -Infinity, Number.MAX_VALUE])(
    'withholds nonrepresentable transforms for %s coordinates',
    (value) => {
      const result = solveTwoPointRegistration({
        design: [
          { x: value, y: 0 },
          { x: -value, y: 0 },
        ],
        machine: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      });
      expect(result.ok).toBe(false);
    },
  );

  it('registers an exact chosen cutting start with its artwork and retains frame preferences', () => {
    const project: Project = {
      ...createProject(),
      startPoints: { job: { x: 5, y: 10 }, frame: { edge: 2, fraction: 0.3 } },
    };
    const registered = applySimilarityProject(project, {
      scale: 2,
      rotationRad: Math.PI / 2,
      translation: { x: 100, y: 50 },
    });
    expect(registered.startPoints?.job?.x).toBeCloseTo(80);
    expect(registered.startPoints?.job?.y).toBeCloseTo(60);
    expect(registered.startPoints?.frame).toEqual(project.startPoints?.frame);
    expect(project.startPoints?.job).toEqual({ x: 5, y: 10 });
  });

  it('retains relative preferences for resolving against registered output bounds', () => {
    const project: Project = {
      ...createProject(),
      startPoints: { job: { x: 0.2, y: 0.8, relative: true } },
    };
    const registered = applySimilarityProject(project, {
      scale: 2,
      rotationRad: Math.PI / 2,
      translation: { x: 100, y: 50 },
    });
    expect(registered.startPoints).toBe(project.startPoints);
  });

  it('maps both design targets exactly onto measured machine points', () => {
    const solved = solveTwoPointRegistration({
      design: [
        { x: 10, y: 20 },
        { x: 40, y: 20 },
      ],
      machine: [
        { x: 100, y: 50 },
        { x: 100, y: 110 },
      ],
    });
    expect(solved.ok).toBe(true);
    if (!solved.ok) return;
    expect(applySimilarityPoint({ x: 10, y: 20 }, solved.transform)).toMatchObject({
      x: 100,
      y: 50,
    });
    const second = applySimilarityPoint({ x: 40, y: 20 }, solved.transform);
    expect(second.x).toBeCloseTo(100);
    expect(second.y).toBeCloseTo(110);
  });

  it('round-trips arbitrary points through the inverse transform', () => {
    const solved = solveTwoPointRegistration({
      design: [
        { x: -5, y: 3 },
        { x: 7, y: 9 },
      ],
      machine: [
        { x: 20, y: -10 },
        { x: 2, y: 26 },
      ],
    });
    if (!solved.ok) throw new Error(solved.reason);
    const point = { x: 13.25, y: -8.5 };
    const roundTrip = applySimilarityPoint(
      applySimilarityPoint(point, solved.transform),
      invertSimilarity(solved.transform),
    );
    expect(roundTrip.x).toBeCloseTo(point.x, 10);
    expect(roundTrip.y).toBeCloseTo(point.y, 10);
  });

  it('rejects coincident design or machine targets', () => {
    expect(
      solveTwoPointRegistration({
        design: [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        machine: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      }),
    ).toEqual({ ok: false, reason: 'Registration targets must be distinct.' });
  });
});
