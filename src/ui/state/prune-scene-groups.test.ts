import { describe, expect, it } from 'vitest';
import type { SceneGroup } from '../../core/scene';
import { groupsForObjectIds, promoteGroupParents } from './prune-scene-groups';

const group = (id: string, objectIds: string[], parentId?: string): SceneGroup => ({
  id,
  name: id,
  objectIds,
  ...(parentId === undefined ? {} : { parentId }),
});

describe('hierarchy-safe artwork subsets', () => {
  it('filters every level, removes undersized groups and preserves kept parent links', () => {
    const groups = [group('root', ['a', 'b', 'c']), group('child', ['a', 'b'], 'root')];
    expect(groupsForObjectIds(groups, new Set(['a', 'c']))).toEqual([group('root', ['a', 'c'])]);
    expect(groupsForObjectIds(groups, new Set(['a', 'b']))).toEqual([
      group('root', ['a', 'b']),
      group('child', ['a', 'b'], 'root'),
    ]);
    expect(groups[0]?.objectIds).toEqual(['a', 'b', 'c']);
  });
  it('detaches a surviving subtree from a missing source parent', () => {
    const groups = [group('child', ['a', 'b'], 'missing'), group('leaf', ['a', 'b'], 'child')];
    expect(groupsForObjectIds(groups, new Set(['a', 'b']))).toEqual([
      group('child', ['a', 'b']),
      group('leaf', ['a', 'b'], 'child'),
    ]);
  });
  it('promotes children through more than one removed ancestor', () => {
    const groups = [
      group('root', ['a', 'b']),
      group('middle', ['a', 'b'], 'root'),
      group('inner', ['a', 'b'], 'middle'),
      group('leaf', ['a', 'b'], 'inner'),
    ];
    expect(
      promoteGroupParents([groups[0]!, groups[3]!], new Map(groups.map((g) => [g.id, g]))),
    ).toEqual([groups[0], group('leaf', ['a', 'b'], 'root')]);
  });
  it('terminates and detaches removed-parent cycles from an untrusted subset', () => {
    const groups = [
      group('one', ['a'], 'two'),
      group('two', ['a'], 'one'),
      group('leaf', ['b', 'c'], 'one'),
    ];
    expect(groupsForObjectIds(groups, new Set(['b', 'c']))).toEqual([group('leaf', ['b', 'c'])]);
  });
});
