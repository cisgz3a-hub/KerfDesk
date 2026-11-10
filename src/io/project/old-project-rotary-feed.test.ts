import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { oldProjectBurnMessages } from '../../ui/state/old-project-burn-messages';
import { deserializeProject } from './deserialize-project';
import { rotaryFeedChangeMessage } from './old-project-rotary-feed';

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
    expect(notice?.rotaryFeed).toEqual([{ yScale: 40 / (Math.PI * 80) }]);
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
    expect(rotaryFeedChangeMessage({ yScale: 360 / (Math.PI * 25) })).toContain(
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
