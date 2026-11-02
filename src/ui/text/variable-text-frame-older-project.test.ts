import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Project, TextObject } from '../../core/scene';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { deserializeProject } from '../../io/project/deserialize-project';
import { outputTextRenderer } from './output-text-renderer';
import { advisoryMessages, burnFrom, type Burn } from './variable-text-frame-testing';

// Rolling audit v9 R4 (ADR-682 Amendment 2, ADR-591 Amendment 3). Placed at Y 50, the frame's top
// burns at Y 350.
const FRAME_TOP = 350;
const NOW = new Date('2026-11-02T00:00:00Z');

describe('a project saved by the real 1.0.28 (33bc394c6), opened on this build', () => {
  // Saved through that release's own buildTextObject and prepareProjectForPersistence, schema 19:
  // EMS Casual Hand, Size 10, centred, fixed 80 × 11 shrink. Its own G-code measured these.
  const RELEASE_BURNS: Readonly<Record<string, Burn>> = {
    Gypsy: { minX: 129.29, maxX: 150.734, minY: 339.32, maxY: 350 },
    Maximilian: { minX: 121.483, maxX: 158.517, minY: 339.61, maxY: 350 },
    Peggy: { minX: 130.459, maxX: 149.541, minY: 339.002, maxY: 349.993 },
    Anna: { minX: 130.741, maxX: 149.259, minY: 341.815, maxY: 350 },
    Al: { minX: 136.976, maxX: 143.024, minY: 341.815, maxY: 350 },
  };

  it.each(Object.keys(RELEASE_BURNS).map((name, index) => [name, index] as const))(
    'burns %s inside the frame the file holds, as 1.0.28 did',
    async (name, recordIndex) => {
      const prepared = await prepareOutputSnapshot(tagOnly(openedRelease()), {
        clock: () => NOW,
        renderVariableText: outputTextRenderer,
        recordIndex,
      });
      const burn = burnFrom(prepared);
      expect(burn.minY, name).toBeGreaterThanOrEqual(FRAME_TOP - 11 - 0.002);
      expect(burn.maxY, name).toBeLessThanOrEqual(FRAME_TOP + 0.002);
      expect(advisoryMessages(prepared), name).toEqual([]);
      // Centred where 1.0.28 centred it, whatever size the refit left.
      const release = RELEASE_BURNS[name] as Burn;
      expect((burn.minX + burn.maxX) / 2, name).toBeCloseTo((release.minX + release.maxX) / 2, 1);
    },
  );

  it('keeps Anna and Al at the size 1.0.28 burned them', async () => {
    for (const [name, recordIndex] of [
      ['Anna', 3],
      ['Al', 4],
    ] as const) {
      const prepared = await prepareOutputSnapshot(tagOnly(openedRelease()), {
        clock: () => NOW,
        renderVariableText: outputTextRenderer,
        recordIndex,
      });
      const burn = burnFrom(prepared);
      const release = RELEASE_BURNS[name] as Burn;
      expect(burn.maxX - burn.minX, name).toBeCloseTo(release.maxX - release.minX, 2);
      expect(burn.maxY - burn.minY, name).toBeCloseTo(release.maxY - release.minY, 2);
    }
  });

  it('names the ? that text saved with Right-to-left on a single-line font still holds', async () => {
    const project = openedRelease();
    const rtl = texts(project).find((text) => text.id === 'relief-rtl') as TextObject;
    const prepared = await prepareOutputSnapshot(
      { ...project, scene: { ...project.scene, objects: [rtl] } },
      { clock: () => NOW, renderVariableText: outputTextRenderer },
    );
    expect(advisoryMessages(prepared)).toEqual([
      'Text “Strasse”: Right-to-left isn’t supported on Relief SingleLine, so it burns left to right. Saved by an older build, it also burns a ? at each end of every line until you edit it.',
    ]);
  });
});

function openedRelease(): Project {
  const bytes = gunzipSync(
    readFileSync(resolve('src/__fixtures__', 'release-1-0-28-casual-hand-frame.lf2.gz')),
  );
  const result = deserializeProject(bytes.toString('utf8'));
  if (result.kind !== 'ok') throw new Error(`fixture did not open: ${JSON.stringify(result)}`);
  expect(result.migratedFrom).toBe(19);
  return result.project;
}

function texts(from: Project): ReadonlyArray<TextObject> {
  return from.scene.objects.filter((object): object is TextObject => object.kind === 'text');
}

function tagOnly(from: Project): Project {
  const tag = texts(from).find((text) => text.id === 'casual-hand-tag');
  if (tag === undefined) throw new Error('fixture text missing');
  return { ...from, scene: { ...from.scene, objects: [tag] } };
}
