import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importLightBurnProject } from './lbrn-import';

const FIXTURE_ROOT = resolve(process.cwd(), 'src/__fixtures__/lightburn/external/lbrn');

const FIXTURES = [
  'acwright-plate.lbrn2',
  'acwright-db25-helper-top.lbrn2',
  'acwright-backplane-top.lbrn2',
  'acwright-keypad-helper-top.lbrn2',
  'acwright-joystick-helper-top.lbrn2',
] as const;

describe('external LightBurn project migration corpus', () => {
  it.each(FIXTURES)('imports %s deterministically with an explicit report', (sourceName) => {
    const xml = fixture(sourceName);
    const first = importLightBurnProject(xml, sourceName);
    const second = importLightBurnProject(xml, sourceName);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.project.scene.objects.length).toBeGreaterThan(0);
    expect(first.report.importedObjects).toBe(first.project.scene.objects.length);
    expect(first.report.importedLayers).toBe(first.project.scene.layers.length);
    expect(first.report.unsupportedShapeTypes).toEqual(
      [...first.report.unsupportedShapeTypes].sort(),
    );
    expect(first.report).toMatchSnapshot();
  });
});

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, name), 'utf8');
}
