import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { createProductionManifest } from '../../core/scene/production-manifest';
import { validateProductionManifest } from './project-manifest-validator';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function manifestFixture() {
  const project = {
    ...createProject(),
    variables: {
      recordIndex: 0,
      serialValue: 10,
      advancement: 'manual' as const,
      csv: { sourceName: 'names.csv', headers: ['name'], records: [['Ada']] },
    },
  };
  let id = 0;
  const manifest = createProductionManifest(project, {
    name: 'Fixed badge run',
    count: 1,
    now: new Date('2026-10-07T00:00:00.000Z'),
    designProjectJson: serializeProject(project),
    idFactory: () => String(++id),
  });
  return { project, manifest, row: manifest.rows[0]! };
}

describe('portable production record integrity', () => {
  it('rejects a row whose recorded data no longer matches its allocated CSV record', () => {
    const { project, manifest, row } = manifestFixture();
    expect(
      deserializeProject(serializeProject({ ...project, productionManifest: manifest })).kind,
    ).toBe('ok');
    const altered = { ...manifest, rows: [{ ...row, values: ['Grace'] }] };
    const result = deserializeProject(
      serializeProject({ ...project, productionManifest: altered }),
    );
    expect(result.kind).not.toBe('ok');
    expect(validateProductionManifest(altered, () => null)).toMatch(/frozen CSV/);
  });

  it('rejects a variant without its capture time and a capture time without its variant', () => {
    const { manifest, row } = manifestFixture();
    for (const change of [
      { reviewedProjectJson: manifest.designProjectJson },
      { reviewedAt: manifest.frozenAt },
    ]) {
      expect(
        validateProductionManifest({ ...manifest, rows: [{ ...row, ...change }] }, () => null),
      ).toMatch(/together/);
    }
  });

  it.each(['text', 'barcode'])('rejects live %s templates in a recorded fixed variant', (kind) => {
    const { project, manifest, row } = manifestFixture();
    const variableTemplate = { tokens: [{ kind: 'serial', prefix: '', width: 3 }] };
    const object =
      kind === 'text'
        ? { kind: 'text', variableTemplate }
        : { kind: 'shape', spec: { kind: 'barcode', variableTemplate } };
    const reviewedProjectJson = JSON.stringify({ ...project, scene: { objects: [object] } });
    // Isolate the fixed-value guard; the normal importer separately validates scene geometry.
    expect(
      validateProductionManifest(
        {
          ...manifest,
          rows: [{ ...row, reviewedProjectJson, reviewedAt: manifest.frozenAt }],
        },
        () => null,
      ),
    ).toMatch(/fixed text and barcode/);
  });
});
