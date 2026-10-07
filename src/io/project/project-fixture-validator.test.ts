import { describe, expect, it } from 'vitest';
import { validateFixtureTemplates } from './project-fixture-validator';
import { normalizeFixtureTemplates } from '../../core/camera/fixtures/fixture-template-normalize';
import { FIXTURE_LIMITS } from '../../core/camera/fixtures/fixture-template';
import { fixtureTemplate } from '../../core/camera/fixtures/fixture-test-support';
import { createProject } from '../../core/scene';
import { serializeProject } from './serialize-project';
import { deserializeProject } from './deserialize-project';

describe('portable fixture metadata', () => {
  it('round trips through the real project serializer with separate camera/height and observation provenance', () => {
    const fixture = fixtureTemplate();
    const observed = {
      ...fixture,
      qualification: {
        ...fixture.qualification!,
        camera: { ...fixture.camera!, surfaceHeightMm: 8 },
      },
    };
    const project = { ...createProject(), fixtureTemplates: [observed] };
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    expect(loaded.project.fixtureTemplates).toEqual([observed]);
    expect(loaded.project.device.cameraModel).toBeUndefined();
    expect(loaded.project.fixtureTemplates![0]!.camera!.surfaceHeightMm).toBe(3);
    expect(loaded.project.fixtureTemplates![0]!.qualification!.camera!.surfaceHeightMm).toBe(8);
  });
  it('accepts absent metadata and rejects malformed references, nonfinite geometry and observation records', () => {
    const fixture = fixtureTemplate();
    expect(validateFixtureTemplates(undefined)).toBeNull();
    expect(validateFixtureTemplates([])).toBeNull();
    const bad = [
      { ...fixture, version: 2 },
      { ...fixture, sample: { ...fixture.sample, slotId: 'missing' } },
      {
        ...fixture,
        slots: [
          {
            ...fixture.slots[0],
            piece: {
              ...fixture.slots[0]!.piece,
              rect: { ...fixture.slots[0]!.piece.rect, width: Number.NaN },
            },
          },
        ],
      },
      { ...fixture, qualification: { ...fixture.qualification, points: [] } },
      { ...fixture, qualification: { ...fixture.qualification, basis: undefined } },
    ];
    for (const item of bad) expect(validateFixtureTemplates([item])).not.toBeNull();
    expect(validateFixtureTemplates([fixture, fixture])).not.toBeNull();
  });
  it('enforces slot, point and byte budgets before metadata can be reopened or placed', () => {
    const fixture = fixtureTemplate(),
      first = fixture.slots[0]!;
    expect(
      validateFixtureTemplates([
        {
          ...fixture,
          slots: Array.from({ length: FIXTURE_LIMITS.slots + 1 }, (_, i) => ({
            ...first,
            id: String(i),
          })),
        },
      ]),
    ).not.toBeNull();
    expect(
      validateFixtureTemplates([
        {
          ...fixture,
          slots: [
            {
              ...first,
              piece: {
                ...first.piece,
                outline: Array.from({ length: FIXTURE_LIMITS.outlinePoints + 1 }, () => ({
                  x: 0,
                  y: 0,
                })),
              },
            },
          ],
        },
      ]),
    ).not.toBeNull();
    expect(
      validateFixtureTemplates([
        { ...fixture, oversized: 'x'.repeat(FIXTURE_LIMITS.templateBytes) },
      ]),
    ).not.toBeNull();
    expect(normalizeFixtureTemplates([fixture])![0]!.slots[0]!.piece).not.toBe(first.piece);
  });
  it('rejects invalid fixture metadata through the ordinary project shape validator', () => {
    const project = { ...createProject(), fixtureTemplates: [{ ...fixtureTemplate(), name: '' }] };
    const result = deserializeProject(JSON.stringify(project));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toContain('fixtureTemplates');
  });
});
