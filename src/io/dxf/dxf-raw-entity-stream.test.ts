import { describe, expect, it } from 'vitest';
import { groupRawEntities } from './dxf-expand';
import { createRawEntityStream } from './dxf-raw-entity-stream';
import type { DxfTag } from './dxf-tags';

function stream(tags: ReadonlyArray<DxfTag>): ReturnType<typeof groupRawEntities>[number][] {
  const streamed: ReturnType<typeof groupRawEntities>[number][] = [];
  const parser = createRawEntityStream((entity) => streamed.push(entity));
  for (const tag of tags) parser.pushTag(tag);
  parser.finish();
  return streamed;
}

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
    expect(stream(tags)).toEqual(groupRawEntities(tags));
  });

  it('drops the SEQEND that ends an INSERT attribute list, like the grouper', () => {
    const tags: DxfTag[] = [
      { code: 0, value: 'INSERT' },
      { code: 66, value: '1' },
      { code: 2, value: 'PART' },
      { code: 0, value: 'ATTRIB' },
      { code: 1, value: 'PN-1' },
      { code: 0, value: 'SEQEND' },
      { code: 8, value: '0' },
      { code: 0, value: 'LINE' },
      { code: 10, value: '1' },
    ];
    const streamed = stream(tags);
    expect(streamed.map((entity) => entity.type)).toEqual(['INSERT', 'ATTRIB', 'LINE']);
    // The SEQEND's own tags do not leak into the next entity.
    expect(streamed[2]?.tags).toEqual([{ code: 10, value: '1' }]);
    expect(streamed).toEqual(groupRawEntities(tags));
  });
});
