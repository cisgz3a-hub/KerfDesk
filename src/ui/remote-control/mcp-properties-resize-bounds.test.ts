import { describe, expect, it } from 'vitest';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { createLayer } from '../../core/scene';
import { useStore } from '../state/store';
import { writeArgs } from './authoring-test-support';
import {
  adapter,
  nativeClient,
  mountProperties,
  groupAt,
  sizeInput,
  submitResize,
} from '../../__fixtures__/mcp-properties';

function expectUnavailable(): void {
  expect(sizeInput('widthMm').value).toBe('');
  expect(sizeInput('heightMm').value).toBe('');
  expect(sizeInput('widthMm').disabled).toBe(true);
  expect(
    document.querySelector<HTMLButtonElement>('#resize-form button[type=submit]')!.disabled,
  ).toBe(true);
}

function fixtureRectangle(id: string) {
  return createRectangle({
    id,
    color: '#000000',
    spec: { widthMm: 10, heightMm: 20, cornerRadiusMm: 0 },
  });
}

describe('bounded complete-target resize metadata and safe fallback', () => {
  it.each(['missing', 'locked', 'hidden', 'private'] as const)(
    'omits the whole-group hint when an expanded member is %s and retains the native refusal',
    async (kind) => {
      const ids = await groupAt();
      const state = useStore.getState();
      const privateId = 'C:/private/group-member.svg';
      useStore.setState({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects
              .map((object) =>
                object.id !== ids[1]
                  ? object
                  : {
                      ...object,
                      ...(kind === 'private' ? { id: privateId } : {}),
                      ...(kind === 'locked' ? { locked: true } : {}),
                      ...(kind === 'hidden' ? { operationIds: ['hidden-op'] } : {}),
                    },
              )
              .filter((object) => kind !== 'missing' || object.id !== ids[1]),
            layers:
              kind === 'hidden'
                ? [
                    ...state.project.scene.layers,
                    { ...createLayer({ id: 'hidden-op', color: '#000000' }), visible: false },
                  ]
                : state.project.scene.layers,
            groups: state.project.scene.groups!.map((group) => ({
              ...group,
              name: 'private-group-name',
              objectIds: group.objectIds.map((id) =>
                kind === 'private' && id === ids[1] ? privateId : id,
              ),
            })),
          },
        },
      });
      const before = useStore.getState();
      const ui = await mountProperties(await nativeClient(), [ids[0]]);
      expectUnavailable();
      expect(
        (ui.workspace['artwork'] as Record<string, unknown>[]).every(
          (item) => item['transformBounds'] === undefined,
        ),
      ).toBe(true);
      expect(JSON.stringify(ui.workspace)).not.toContain('private');
      expect(document.getElementById('authoring-selection')!.textContent).toContain(
        'hidden, locked or unlisted',
      );
      submitResize();
      await ui.settle();
      expect(ui.writes).toEqual([]);
      expect(useStore.getState()).toBe(before);
      const result = await adapter.execute(
        'transform_artwork',
        writeArgs(adapter, {
          artworkIds: [ids[0]],
          transform: { type: 'resize', widthMm: 60, heightMm: 40 },
        }),
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code:
            kind === 'missing'
              ? 'not_found'
              : kind === 'private'
                ? 'unsupported_operation'
                : 'not_editable',
        },
      });
      expect(useStore.getState()).toBe(before);
    },
  );

  it('omits a complete group when one safe member falls beyond the 200-item public snapshot', async () => {
    const ids = await groupAt();
    const state = useStore.getState();
    const objects = [
      state.project.scene.objects[0]!,
      ...Array.from({ length: 199 }, (_, index) => fixtureRectangle('unrelated-' + index)),
      state.project.scene.objects[1]!,
    ];
    useStore.setState({
      project: { ...state.project, scene: { ...state.project.scene, objects } },
    });
    const before = useStore.getState();
    const ui = await mountProperties(await nativeClient(), [ids[0]]);
    expect(ui.workspace).toMatchObject({ truncated: true, totalArtwork: 201 });
    expect(ui.workspace['artwork']).toHaveLength(200);
    expect((ui.workspace['artwork'] as Record<string, unknown>[])[0]).not.toHaveProperty(
      'transformBounds',
    );
    expect(new TextEncoder().encode(JSON.stringify(ui.workspace)).length).toBeLessThan(256 * 1024);
    expectUnavailable();
    submitResize();
    await ui.settle();
    expect(ui.writes).toEqual([]);
    expect(useStore.getState()).toBe(before);
  });

  it.each([200, 201])(
    'respects the backend expansion cap for a %s-member persistent group',
    async (count) => {
      const objects = Array.from({ length: count }, (_, index) =>
        fixtureRectangle('member-' + index),
      );
      const state = useStore.getState();
      useStore.setState({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects,
            groups: [
              {
                id: 'large-group',
                name: 'private-group-name',
                objectIds: objects.map((object) => object.id),
              },
            ],
          },
        },
      });
      const before = useStore.getState();
      const ui = await mountProperties(await nativeClient(), [objects[0]!.id]);
      expect(ui.workspace['artwork']).toHaveLength(200);
      expect(new TextEncoder().encode(JSON.stringify(ui.workspace)).length).toBeLessThan(
        256 * 1024,
      );
      if (count === 200) {
        expect(sizeInput('widthMm').value).toBe('10');
        submitResize();
        await ui.settle();
        expect(ui.writes).toHaveLength(1);
        expect(useStore.getState().project.scene.objects).toEqual(before.project.scene.objects);
      } else {
        expectUnavailable();
        submitResize();
        await ui.settle();
        expect(ui.writes).toEqual([]);
        expect(
          await adapter.execute(
            'transform_artwork',
            writeArgs(adapter, {
              artworkIds: [objects[0]!.id],
              transform: { type: 'resize', widthMm: 20, heightMm: 40 },
            }),
          ),
        ).toMatchObject({ ok: false, error: { code: 'unsupported_operation' } });
        expect(useStore.getState()).toBe(before);
      }
      expect(JSON.stringify(ui.workspace)).not.toContain('private-group-name');
    },
  );

  it.each(['legacy', 'missing-hint'] as const)(
    'clears dimensions and explains the %s fallback',
    async (kind) => {
      const ids = await groupAt();
      const before = useStore.getState();
      const ui = await mountProperties(await nativeClient(), [ids[0]], (value) => ({
        ...value,
        ...(kind === 'legacy' ? { capabilities: { touchEditing: true } } : {}),
        artwork: (value['artwork'] as Record<string, unknown>[]).map(
          ({ transformBounds: _hint, ...item }) => item,
        ),
      }));
      expectUnavailable();
      expect(document.getElementById('authoring-selection')!.textContent).toContain(
        kind === 'legacy' ? 'Update KerfDesk on the PC' : 'Resize is unavailable',
      );
      submitResize();
      await ui.settle();
      expect(ui.writes).toEqual([]);
      expect(useStore.getState()).toBe(before);
    },
  );

  it.each(['non-finite', 'degenerate'] as const)(
    'omits unsafe %s dimensions from the real native envelope',
    async (kind) => {
      const object = fixtureRectangle('unsafe');
      const state = useStore.getState();
      useStore.setState({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: [
              {
                ...object,
                bounds: { ...object.bounds, maxX: kind === 'non-finite' ? Infinity : 0 },
              },
            ],
          },
        },
      });
      const before = useStore.getState();
      const ui = await mountProperties(await nativeClient(), [object.id]);
      expect((ui.workspace['artwork'] as Record<string, unknown>[])[0]).not.toHaveProperty(
        'transformBounds',
      );
      expect(JSON.stringify(ui.workspace)).not.toContain('Infinity');
      expectUnavailable();
      submitResize();
      await ui.settle();
      expect(ui.writes).toEqual([]);
      expect(useStore.getState()).toBe(before);
    },
  );
});
