import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { oldProjectBurnMessages } from '../../ui/state/old-project-burn-messages';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../core/devices';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { rotaryFeedChange, rotaryFeedChangeMessage } from './old-project-rotary-feed';

// Rolling audit v13 Y5-P2-2 (ADR-127 Amendment 2, ADR-682 Amendment 3): a
// rotary project saved by 1.0.30 or earlier says on open that its strokes
// round the part now burn with another energy. Real files saved by 1.0.29 and
// 1.0.30.

const FOLDER = 'src/__fixtures__/returning-user';

function opened(json: string) {
  const result = deserializeProject(json);
  if (result.kind !== 'ok') throw new Error(`did not open: ${result.kind}`);
  return result;
}

const GOLDEN_1_0_30: { readonly projects: Readonly<Record<string, string>> } = JSON.parse(
  gunzipSync(readFileSync(resolve(FOLDER, '1.0.30-rotary.golden.json.gz'))).toString('utf8'),
);

describe('old-project notice for rotary feeds', () => {
  it('names a 1.0.29 chuck project: 6.28x the energy round the part', () => {
    const file = gunzipSync(readFileSync(resolve(FOLDER, '1.0.29-rotary.lf2.gz'))).toString('utf8');
    const notice = opened(file).oldProjectBurn;
    expect(notice?.rotaryFeed).toEqual([
      { yScale: 40 / (Math.PI * 80), ratio: expect.closeTo(Math.PI * 2, 2) },
    ]);
    if (notice === undefined) throw new Error('no notice');
    expect(oldProjectBurnMessages(notice).burn).toContain(
      'On this rotary, strokes round the part now move it at the layer speed, so they burn up ' +
        'to 6.28× the energy they did, because KerfDesk 1.0.30 and earlier ran them faster than ' +
        'the speed you set. If you tuned power or speed for the old burn, set them again and run ' +
        'a test before you burn real stock.',
    );
  });

  it('notices exactly the 1.0.30 projects whose rotary is scaled', () => {
    const noticed = Object.entries(GOLDEN_1_0_30.projects)
      .filter(([, json]) => (opened(json).oldProjectBurn?.rotaryFeed?.length ?? 0) > 0)
      .map(([name]) => name)
      .sort();
    const scaled = Object.entries(GOLDEN_1_0_30.projects)
      .filter(([, json]) => {
        const rotary = JSON.parse(json).device?.rotary;
        return (
          rotary?.enabled === true &&
          (rotary.type === 'chuck' || rotary.rollerDiameterMm !== undefined)
        );
      })
      .map(([name]) => name)
      .sort();
    expect(scaled.length).toBeGreaterThan(0);
    expect(noticed).toEqual(scaled);
  });

  it('says a k > 1 roller burns less than it did', () => {
    expect(
      rotaryFeedChangeMessage({ yScale: 360 / (Math.PI * 25), ratio: (Math.PI * 25) / 360 }),
    ).toContain(
      'as little as 0.22× the energy they did, because KerfDesk 1.0.30 and earlier ran them ' +
        'slower than the speed you set',
    );
  });

  it('stays quiet for a project saved by 1.0.31 (schema 22)', () => {
    const file = gunzipSync(readFileSync(resolve(FOLDER, '1.0.29-rotary.lf2.gz'))).toString('utf8');
    const resaved = JSON.parse(file);
    resaved.schemaVersion = 22;
    expect(opened(JSON.stringify(resaved)).oldProjectBurn?.rotaryFeed ?? []).toEqual([]);
  });
});

// Rolling audit v14 Z3-P3-3: only strokes whose dose really changed count,
// and the notice names the real change.
describe('which old rotary projects changed (ADR-127 Amd 4)', () => {
  const CHUCK: RotarySetup = {
    enabled: true,
    type: 'chuck',
    mmPerRotation: 40,
    objectDiameterMm: 80,
  };
  const PLACEHOLDER: RotarySetup = {
    enabled: true,
    type: 'roller',
    mmPerRotation: 360,
    objectDiameterMm: 80,
    rollerDiameterMm: 25,
  };

  function project(
    rotary: RotarySetup,
    layer: Partial<Layer>,
    to: { x: number; y: number },
  ): Project {
    const object: SceneObject = {
      kind: 'imported-svg',
      id: 'O1',
      source: 'a.svg',
      bounds: { minX: 10, minY: 10, maxX: Math.max(10, to.x), maxY: Math.max(10, to.y) },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#ff0000', polylines: [{ points: [{ x: 10, y: 10 }, to], closed: false }] }],
    };
    const base = createProject({ ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000, rotary });
    const operation = { ...createLayer({ id: 'L1', color: '#ff0000' }), ...layer };
    return { ...base, scene: addLayer(addObject(base.scene, object), operation) };
  }

  it('stays quiet for a line along X and for a 0° Fill', () => {
    expect(rotaryFeedChange(project(CHUCK, {}, { x: 40, y: 10 }))).toEqual([]);
    expect(
      rotaryFeedChange(project(CHUCK, { mode: 'fill', hatchAngleDeg: 0 }, { x: 40, y: 40 })),
    ).toEqual([]);
  });

  it('names 6.28× for a stroke round the part in the chuck, and for a 90° Fill', () => {
    expect(rotaryFeedChange(project(CHUCK, {}, { x: 10, y: 40 }))[0]?.ratio).toBeCloseTo(
      2 * Math.PI,
      6,
    );
    expect(
      rotaryFeedChange(project(CHUCK, { mode: 'fill', hatchAngleDeg: 90 }, { x: 40, y: 40 }))[0]
        ?.ratio,
    ).toBeCloseTo(2 * Math.PI, 6);
  });

  it('names the held change on a k > 1 roller: 0.25×, not 1/k', () => {
    // 1500 mm/min round the part needs 6876 > Max feed 6000, so the new dose is 1500/6000.
    const [change] = rotaryFeedChange(project(PLACEHOLDER, { speed: 1500 }, { x: 10, y: 40 }));
    expect(change?.ratio).toBeCloseTo(0.25, 6);
    expect(rotaryFeedChangeMessage(change ?? { yScale: 1, ratio: 1 })).toContain(
      'as little as 0.25×',
    );
  });
});
