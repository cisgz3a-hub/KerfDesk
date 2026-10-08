import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type Scene, type SceneGroup } from './index';
import { moveDesignNode, type DesignHierarchyMove } from './design-hierarchy-edit';
import { designNodeChildren } from './design-hierarchy-membership';
import { designNodeOrder, pruneDesignTreeOrder } from './design-hierarchy-order';

function scene(
  groups: ReadonlyArray<SceneGroup> = [
    { id: 'P', name: 'Old parent', objectIds: ['A', 'B', 'C', 'D', 'E'] },
    { id: 'T', name: 'Moving group', objectIds: ['A', 'B', 'C'], parentId: 'P' },
    { id: 'Q', name: 'New parent', objectIds: ['F', 'G', 'H'] },
  ],
): Scene {
  return {
    objects: [...'ABCDEFGHI'].map((id) => ({
      kind: 'imported-svg',
      id,
      source: id,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [],
    })),
    layers: [],
    artworkOrder: ['I', 'H', 'A'],
    groups,
  };
}
function moved(input: Scene, move: DesignHierarchyMove): Scene {
  const result = moveDesignNode(input, move);
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error(result.message);
  validateMembershipIndependently(result.scene);
  expect(result.scene.objects).toBe(input.objects);
  expect(result.scene.layers).toBe(input.layers);
  expect(result.scene.artworkOrder).toBe(input.artworkOrder);
  return result.scene;
}
function validateMembershipIndependently(input: Scene): void {
  const groups = new Map(input.groups?.map((group) => [group.id, group]));
  for (const group of groups.values()) {
    expect(new Set(group.objectIds).size).toBe(group.objectIds.length);
    expect(group.objectIds.length).toBeGreaterThanOrEqual(2);
    const seen = new Set([group.id]);
    let parent = group.parentId;
    while (parent !== undefined) {
      expect(seen.has(parent)).toBe(false);
      seen.add(parent);
      const ancestor = groups.get(parent);
      expect(ancestor).toBeDefined();
      for (const id of group.objectIds) expect(ancestor?.objectIds).toContain(id);
      parent = ancestor?.parentId;
    }
  }
}
function members(input: Scene, id: string): ReadonlyArray<string> | undefined {
  return input.groups?.find((group) => group.id === id)?.objectIds;
}
describe('design hierarchy transfers', () => {
  it('compares sibling identities structurally when valid IDs contain line breaks', () => {
    const base = scene([]);
    const first = base.objects[0]!;
    const input: Scene = {
      ...base,
      objects: [
        { ...first, id: 'a' },
        { ...first, id: 'a\nobject:a' },
      ],
    };
    const next = moved(input, { node: { kind: 'object', id: 'a' }, parentId: null });
    expect(next).not.toBe(input);
    expect(designNodeChildren(next, null)).toEqual([
      { kind: 'object', id: 'a\nobject:a' },
      { kind: 'object', id: 'a' },
    ]);
  });
  it('reparents a complete group, removing old ancestor membership and adding new ancestors', () => {
    const input = scene();
    const next = moved(input, { node: { kind: 'group', id: 'T' }, parentId: 'Q' });
    expect(members(next, 'P')).toEqual(['D', 'E']);
    expect(members(next, 'Q')).toEqual(['F', 'G', 'H', 'A', 'B', 'C']);
    expect(next.groups?.find((group) => group.id === 'T')?.parentId).toBe('Q');
    expect(members(next, 'T')).toBe(members(input, 'T'));
    expect(members(input, 'P')).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('transfers an object through full ancestor chains and supports root promotion', () => {
    const input = scene();
    const toQ = moved(input, { node: { kind: 'object', id: 'C' }, parentId: 'Q' });
    expect(members(toQ, 'T')).toEqual(['A', 'B']);
    expect(members(toQ, 'P')).toEqual(['A', 'B', 'D', 'E']);
    expect(members(toQ, 'Q')).toEqual(['F', 'G', 'H', 'C']);
    const toRoot = moved(input, { node: { kind: 'group', id: 'T' }, parentId: null });
    expect(toRoot.groups?.find((group) => group.id === 'T')?.parentId).toBeUndefined();
    expect(members(toRoot, 'P')).toEqual(['D', 'E']);
  });
  it('updates multiple old/new ancestors while retaining a nested descendant', () => {
    const input = scene([
      { id: 'R', name: 'Old root', objectIds: ['A', 'B', 'C', 'D', 'E', 'I'] },
      { id: 'P', name: 'Old parent', objectIds: ['A', 'B', 'C', 'D', 'E'], parentId: 'R' },
      { id: 'T', name: 'Moving group', objectIds: ['A', 'B', 'C'], parentId: 'P' },
      { id: 'U', name: 'Inner pair', objectIds: ['A', 'B'], parentId: 'T' },
      { id: 'N', name: 'New root', objectIds: ['F', 'G', 'H'] },
      { id: 'Q', name: 'New parent', objectIds: ['F', 'G', 'H'], parentId: 'N' },
    ]);
    const next = moved(input, { node: { kind: 'group', id: 'T' }, parentId: 'Q' });
    expect(members(next, 'R')).toEqual(['D', 'E', 'I']);
    expect(members(next, 'P')).toEqual(['D', 'E']);
    for (const id of ['N', 'Q']) expect(members(next, id)).toEqual(['F', 'G', 'H', 'A', 'B', 'C']);
    expect(next.groups?.find((group) => group.id === 'U')).toBe(
      input.groups?.find((group) => group.id === 'U'),
    );
    expect(moveDesignNode(input, { node: { kind: 'group', id: 'T' }, parentId: 'U' }).kind).toBe(
      'error',
    );
  });
  it('retains common ancestors when promoting artwork inside the same family', () => {
    const input = scene();
    const next = moved(input, { node: { kind: 'object', id: 'C' }, parentId: 'P' });
    expect(members(next, 'P')).toBe(members(input, 'P'));
    expect(members(next, 'T')).toEqual(['A', 'B']);
    expect(designNodeChildren(next, 'P')).toEqual([
      { kind: 'group', id: 'T' },
      { kind: 'object', id: 'D' },
      { kind: 'object', id: 'E' },
      { kind: 'object', id: 'C' },
    ]);
  });
  it('inserts group and object siblings without changing output or canvas order', () => {
    const input = scene();
    const next = moved(input, {
      node: { kind: 'object', id: 'I' },
      parentId: null,
      before: { kind: 'group', id: 'P' },
    });
    expect(designNodeChildren(next, null)).toEqual([
      { kind: 'object', id: 'I' },
      { kind: 'group', id: 'P' },
      { kind: 'group', id: 'Q' },
    ]);
    const same = moveDesignNode(next, {
      node: { kind: 'object', id: 'I' },
      parentId: null,
      before: { kind: 'group', id: 'P' },
    });
    expect(same).toEqual({ kind: 'ok', scene: next });
    if (same.kind === 'ok') expect(same.scene).toBe(next);
  });
  it('rejects singleton-leaving transfers with a concrete reason and preserves every group', () => {
    const input = scene([
      { id: 'pair', name: 'Pair', objectIds: ['A', 'B'] },
      { id: 'other', name: 'Other', objectIds: ['C', 'D'] },
    ]);
    const result = moveDesignNode(input, { node: { kind: 'object', id: 'A' }, parentId: 'other' });
    expect(result).toEqual({
      kind: 'error',
      message: expect.stringContaining('leave “Pair” with 1 artwork'),
    });
    expect(input.groups).toHaveLength(2);
    expect(members(input, 'pair')).toEqual(['A', 'B']);
  });
  it('preserves legacy overlaps, allowing group reorder but rejecting ambiguous transfers', () => {
    const input = scene([
      { id: 'one', name: 'One', objectIds: ['A', 'B'] },
      { id: 'two', name: 'Two', objectIds: ['B', 'C'] },
      { id: 'three', name: 'Three', objectIds: ['D', 'E'] },
    ]);
    const reordered = moved(input, {
      node: { kind: 'group', id: 'two' },
      parentId: null,
      before: { kind: 'group', id: 'one' },
    });
    expect(reordered.groups).toBe(input.groups);
    expect(moveDesignNode(input, { node: { kind: 'object', id: 'B' }, parentId: null })).toEqual({
      kind: 'error',
      message: expect.stringContaining('overlapping legacy groups'),
    });
    expect(
      moveDesignNode(input, { node: { kind: 'group', id: 'one' }, parentId: 'three' }),
    ).toEqual({ kind: 'error', message: expect.stringContaining('“Two”') });
  });
  it.each([
    [{ kind: 'group', id: 'P' }, 'T', null, 'descendants'],
    [{ kind: 'group', id: 'T' }, 'T', null, 'itself'],
    [{ kind: 'object', id: 'missing' }, null, null, 'no longer exists'],
    [{ kind: 'object', id: 'I' }, 'missing', null, 'destination'],
    [{ kind: 'object', id: 'I' }, null, { kind: 'object', id: 'A' }, 'direct child'],
  ] as const)(
    'rejects invalid node, parent or insertion target %j',
    (node, parentId, before, reason) => {
      expect(moveDesignNode(scene(), { node, parentId, before })).toEqual({
        kind: 'error',
        message: expect.stringContaining(reason),
      });
    },
  );
  it('rejects locked artwork and groups containing locked descendants', () => {
    const input = scene();
    const locked = {
      ...input,
      objects: input.objects.map((object) =>
        object.id === 'A' ? { ...object, locked: true } : object,
      ),
    };
    for (const node of [
      { kind: 'object', id: 'A' },
      { kind: 'group', id: 'T' },
    ] as const)
      expect(moveDesignNode(locked, { node, parentId: 'Q' })).toEqual({
        kind: 'error',
        message: expect.stringContaining('Unlock'),
      });
  });
  it('prunes only stale/duplicate presentation ranks, leaving missing new rows in deterministic fallback order', () => {
    const input = {
      ...scene(),
      designTreeOrder: [
        { kind: 'object', id: 'I' },
        { kind: 'group', id: 'gone' },
        { kind: 'object', id: 'I' },
        { kind: 'group', id: 'Q' },
      ] as const,
    };
    const next = pruneDesignTreeOrder(input);
    expect(next.designTreeOrder).toEqual([
      { kind: 'object', id: 'I' },
      { kind: 'group', id: 'Q' },
    ]);
    expect(designNodeOrder(next)).toHaveLength(input.objects.length + (input.groups?.length ?? 0));
    expect(designNodeChildren(next, null)).toEqual([
      { kind: 'object', id: 'I' },
      { kind: 'group', id: 'Q' },
      { kind: 'group', id: 'P' },
    ]);
    expect(next.objects).toBe(input.objects);
    expect(next.artworkOrder).toBe(input.artworkOrder);
  });
});
