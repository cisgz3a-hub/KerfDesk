import { describe, expect, it } from 'vitest';
import type { HoleGridGenerator } from './part-generator';
import { generatedPart, requirePart } from './part-generator.test-fixture';
import { regeneratePartGenerator } from './regenerate-part-generator';

describe('generated part machining identity after manual path edits', () => {
  it('discloses a deleted boundary instead of assigning hole machining to its replacement', () => {
    const original = generatedPart();
    const edited = { ...original, paths: original.paths.slice(1) };
    const result = regeneratePartGenerator(edited, original.partGenerator.definition);
    const actual =
      result.kind === 'ok'
        ? { kind: result.kind, restoredBoundaryOperations: result.value.paths[0]?.operationIds }
        : result;
    expect(actual).toEqual({
      kind: 'invalid',
      reason: expect.stringMatching(/machining bindings.*[Bb]ake/),
    });
    expect(edited.paths[0]?.operationIds).toEqual(['holes']);
    expect(edited.partGenerator).toBe(original.partGenerator);
  });

  it('retains boundary, individual hole operations and current tab references after path reorder', () => {
    const original = generatedPart();
    const definition = original.partGenerator.definition as HoleGridGenerator;
    const tabKey = 'hole-r1-c0';
    const paths = original.paths.map((path, index) => ({
      ...path,
      operationIds: ['cut-' + original.partGenerator.pathKeys[index]],
      strokeWidthMm: index + 0.25,
    }));
    const tabIndex = paths.length - 1 - original.partGenerator.pathKeys.indexOf(tabKey);
    const reordered = {
      ...original,
      paths: paths.toReversed(),
      cncTabAnchors: [{ layerColor: '#000000', pathIndex: tabIndex, polylineIndex: 0, pathT: 0.3 }],
      laserTabAnchors: [
        { layerColor: '#000000', pathIndex: tabIndex, polylineIndex: 0, pathT: 0.7 },
      ],
    };
    const result = requirePart(
      regeneratePartGenerator(reordered, { ...definition, widthMm: 80, columns: 5 }),
    );
    for (const [index, key] of original.partGenerator.pathKeys.entries()) {
      const nextIndex = result.partGenerator.pathKeys.indexOf(key);
      expect(result.paths[nextIndex]?.operationIds).toEqual(['cut-' + key]);
      expect(result.paths[nextIndex]?.strokeWidthMm).toBe(index + 0.25);
    }
    const nextTabIndex = result.partGenerator.pathKeys.indexOf(tabKey);
    expect(result.cncTabAnchors?.[0]?.pathIndex).toBe(nextTabIndex);
    expect(result.laserTabAnchors?.[0]?.pathIndex).toBe(nextTabIndex);
    expect(reordered.paths[0]?.operationIds).toEqual(['cut-hole-r2-c3']);
    expect(result.operationOverride).toBe(original.operationOverride);
  });

  it('refuses a changed compatibility outline even when the retained exact curve still matches', () => {
    const original = generatedPart();
    const edited = {
      ...original,
      paths: original.paths.map((path, index) =>
        index === 1
          ? {
              ...path,
              polylines: path.polylines.map((polyline) => ({
                ...polyline,
                points: polyline.points.map((point, pointIndex) =>
                  pointIndex === 0 ? { ...point, x: point.x + 1 } : point,
                ),
              })),
            }
          : path,
      ),
    };
    expect(regeneratePartGenerator(edited, original.partGenerator.definition)).toMatchObject({
      kind: 'invalid',
      reason: /machining bindings.*[Bb]ake/,
    });
  });
  it('rejects duplicate manual geometry whose old semantic path cannot be recovered', () => {
    const original = generatedPart();
    const edited = {
      ...original,
      paths: original.paths.map((path, index) => original.paths[index === 1 ? 2 : index] ?? path),
    };
    expect(regeneratePartGenerator(edited, original.partGenerator.definition)).toMatchObject({
      kind: 'invalid',
      reason: /machining bindings.*[Bb]ake/,
    });
  });
});
