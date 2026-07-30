import { describe, expect, it } from 'vitest';
import {
  addEntities,
  addEntity,
  findEntity,
  removeEntities,
  replaceEntity,
  setEntityConstruction,
} from './sketch-edit';
import { EMPTY_SKETCH, type Sketch, type SketchLine } from './sketch-entity';

const lineAt = (id: string, x: number): SketchLine => ({
  kind: 'line',
  id,
  start: { x, y: 0 },
  end: { x: x + 10, y: 0 },
});

const twoLines: Sketch = { entities: [lineAt('a', 0), lineAt('b', 20)] };

describe('addEntity', () => {
  it('appends, preserving z-order', () => {
    const sketch = addEntity(twoLines, lineAt('c', 40));
    expect(sketch.entities.map((entity) => entity.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input sketch', () => {
    addEntity(twoLines, lineAt('c', 40));
    expect(twoLines.entities).toHaveLength(2);
  });

  it('drops a degenerate entity instead of adding it', () => {
    const dead: SketchLine = { kind: 'line', id: 'x', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } };
    expect(addEntity(twoLines, dead)).toBe(twoLines);
  });

  it('refuses a duplicate id, leaving the sketch untouched', () => {
    expect(addEntity(twoLines, lineAt('a', 99))).toBe(twoLines);
  });
});

describe('addEntities', () => {
  it('adds every valid entity in order', () => {
    const sketch = addEntities(EMPTY_SKETCH, [lineAt('a', 0), lineAt('b', 20)]);
    expect(sketch.entities.map((entity) => entity.id)).toEqual(['a', 'b']);
  });
});

describe('replaceEntity', () => {
  it('replaces in place, keeping z-order', () => {
    const sketch = replaceEntity(twoLines, lineAt('a', 100));
    expect(sketch.entities.map((entity) => entity.id)).toEqual(['a', 'b']);
    expect((sketch.entities[0] as SketchLine).start.x).toBe(100);
  });

  it('ignores an unknown id', () => {
    expect(replaceEntity(twoLines, lineAt('zzz', 5))).toBe(twoLines);
  });

  it('ignores a degenerate replacement rather than deleting the entity', () => {
    const dead: SketchLine = { kind: 'line', id: 'a', start: { x: 1, y: 1 }, end: { x: 1, y: 1 } };
    expect(replaceEntity(twoLines, dead)).toBe(twoLines);
  });
});

describe('removeEntities', () => {
  it('removes the named ids', () => {
    const sketch = removeEntities(twoLines, new Set(['a']));
    expect(sketch.entities.map((entity) => entity.id)).toEqual(['b']);
  });

  it('returns the same sketch when nothing matches', () => {
    expect(removeEntities(twoLines, new Set(['nope']))).toBe(twoLines);
    expect(removeEntities(twoLines, new Set())).toBe(twoLines);
  });
});

describe('findEntity', () => {
  it('finds by id and returns null when absent', () => {
    expect(findEntity(twoLines, 'b')?.id).toBe('b');
    expect(findEntity(twoLines, 'nope')).toBeNull();
  });
});

describe('setEntityConstruction', () => {
  it('flags an entity as construction geometry', () => {
    const sketch = setEntityConstruction(twoLines, 'a', true);
    expect(sketch.entities[0]?.construction).toBe(true);
    expect(sketch.entities[1]?.construction).toBeUndefined();
  });

  it('ignores an unknown id', () => {
    expect(setEntityConstruction(twoLines, 'nope', true)).toBe(twoLines);
  });
});
