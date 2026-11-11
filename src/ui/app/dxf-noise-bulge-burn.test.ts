// Rolling audit v11 W5-P1-1 through the real store import and compile, as the
// refuter's bulgeburn repro ran it: a noise bulge on one edge of a 40 x 30 mm
// plate burned it 70-141 mm wide, and a 1e-18 bulge shrank it to 29 % under a
// "larger than the bed" fit (ADR-159 Amendment 3).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import type { SceneObject } from '../../core/scene';
import { parseDxf } from '../../io/dxf';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';

const plateDxf = (bulge: string): string =>
  [
    ...['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC'],
    ...['0', 'SECTION', '2', 'ENTITIES'],
    ...['0', 'LWPOLYLINE', '8', '0', '90', '4', '70', '1'],
    ...['10', '0', '20', '0', '42', bulge],
    ...['10', '40', '20', '0', '10', '40', '20', '30', '10', '0', '20', '30'],
    ...['0', 'ENDSEC', '0', 'EOF'],
  ].join('\n');

function burnExtentX(): { readonly min: number; readonly max: number } {
  const { project } = useStore.getState();
  const xs: number[] = [];
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.x === 'number' && typeof record.y === 'number') {
      xs.push(record.x);
      return;
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(compileJob(project.scene, project.device).groups);
  return { min: Math.min(...xs), max: Math.max(...xs) };
}

beforeEach(resetStore);
afterEach(resetStore);

describe('a noise-bulge plate burns at its drawn size', () => {
  it.each(['0', '2.4492935982947064e-17', '1e-17', '1e-18', '1e-19'])(
    'bulge %s: 40 mm wide, at scale 1',
    (bulge) => {
      const parsed = parseDxf({ dxfText: plateDxf(bulge), id: 'plate', source: 'p.dxf' });
      if (parsed.kind !== 'ok' || parsed.object === null) throw new Error(JSON.stringify(parsed));
      const outcome = useStore.getState().importSvgObject(parsed.object as SceneObject);
      expect(outcome.kind).toBe('added');
      const placed = useStore.getState().project.scene.objects.at(-1);
      expect(placed?.transform.scaleX).toBe(1);
      const extent = burnExtentX();
      expect(extent.max - extent.min).toBeCloseTo(40, 6);
    },
  );
});
