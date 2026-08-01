import { describe, expect, it } from 'vitest';
import { groupRawEntities } from './dxf-expand';
import { createRawEntityStream } from './dxf-raw-entity-stream';
import type { DxfTag } from './dxf-tags';

describe('createRawEntityStream', () => {
  it('matches grouped ordinary and classic POLYLINE entities', () => {
    const tags: DxfTag[] = [
      { code: 0, value: 'LINE' },
      { code: 10, value: '1' },
      { code: 0, value: 'POLYLINE' },
      { code: 70, value: '1' },
      { code: 0, value: 'VERTEX' },
      { code: 10, value: '0' },
      { code: 0, value: 'VERTEX' },
      { code: 10, value: '2' },
      { code: 0, value: 'SEQEND' },
      { code: 0, value: 'CIRCLE' },
      { code: 40, value: '3' },
    ];
    const streamed: ReturnType<typeof groupRawEntities>[number][] = [];
    const parser = createRawEntityStream((entity) => streamed.push(entity));
    for (const tag of tags) parser.pushTag(tag);
    parser.finish();

    expect(streamed).toEqual(groupRawEntities(tags));
  });
});
