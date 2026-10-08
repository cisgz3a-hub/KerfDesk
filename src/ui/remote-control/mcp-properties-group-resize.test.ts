import { describe, expect, it } from 'vitest';
import { combinedBBox } from '../../core/scene/hit-test';
import { useStore } from '../state/store';
import { addTestRectangle, writeArgs } from './authoring-test-support';
import {
  adapter,
  nativeClient,
  mountProperties,
  groupAt,
  sizeInput,
  submitResize,
  setWritable,
} from '../../__fixtures__/mcp-properties';

function typeSize(name: string, value: string): void {
  const input = sizeInput(name);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function resizeButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>('#resize-form button[type=submit]')!;
}

async function workspace(client: Awaited<ReturnType<typeof nativeClient>>) {
  const result = await client.callTool({ name: 'get_workspace', arguments: {} });
  const content = result.structuredContent;
  if (content === null || typeof content !== 'object' || Array.isArray(content))
    throw new Error('Expected native workspace');
  return content as Record<string, unknown>;
}

describe('embedded MCP Properties composed with the native tool and desktop backend', () => {
  it('keeps a whole group unchanged when only one member is checked and displayed dimensions are submitted', async () => {
    const ids = await groupAt();
    const before = useStore.getState();
    const client = await nativeClient();
    const ui = await mountProperties(client, [ids[0]]);
    expect(useStore.getState()).toBe(before);
    expect(ui.writes).toEqual([]);
    expect(ui.workspace).toMatchObject({
      capabilities: { groupTransformBounds: true },
      artwork: ids.map((id) => ({
        id,
        bounds: { widthMm: 10, heightMm: 20 },
        transformBounds: { xMm: 0, yMm: 0, widthMm: 30, heightMm: 20 },
      })),
    });
    expect(JSON.stringify(ui.workspace)).not.toContain('objectIds');
    expect(sizeInput('widthMm').value).toBe('30');
    expect(sizeInput('heightMm').value).toBe('20');
    expect(resizeButton().disabled).toBe(false);
    submitResize();
    await ui.settle();
    expect(ui.writes).toHaveLength(1);
    expect(ui.writes[0]).toMatchObject({
      name: 'transform_artwork',
      args: { artworkIds: [ids[0]], expectedRevision: ui.workspace['revision'] },
    });
    expect(combinedBBox(useStore.getState().project.scene.objects)).toEqual(
      combinedBBox(before.project.scene.objects),
    );
    expect(useStore.getState().project.scene.objects.map((object) => object.transform)).toEqual(
      before.project.scene.objects.map((object) => object.transform),
    );
  });

  it('resizes every group member in one undo step through the real tool and keeps another group intact', async () => {
    const ids = await groupAt();
    await groupAt(100);
    const before = useStore.getState();
    const client = await nativeClient();
    const ui = await mountProperties(client, [ids[0]]);
    typeSize('widthMm', '60');
    typeSize('heightMm', '40');
    submitResize();
    await ui.settle();
    const after = useStore.getState();
    expect(after.project.scene.objects.slice(0, 2).map((object) => object.transform)).toMatchObject(
      [
        { x: 0, y: 0, scaleX: 2, scaleY: 2 },
        { x: 40, y: 0, scaleX: 2, scaleY: 2 },
      ],
    );
    expect(after.project.scene.objects.slice(2)).toEqual(before.project.scene.objects.slice(2));
    expect(after.project.scene.groups).toBe(before.project.scene.groups);
    expect(after.undoStack).toHaveLength(before.undoStack.length + 1);
    const request = ui.writes[0]!;
    expect(
      await client.callTool({ name: request.name, arguments: request.args }),
    ).not.toMatchObject({ isError: true });
    expect(useStore.getState().undoStack).toBe(after.undoStack);
    expect(
      await client.callTool({ name: 'undo', arguments: writeArgs(adapter) }),
    ).not.toMatchObject({ isError: true });
    expect(useStore.getState().project.scene).toEqual(before.project.scene);
  });

  it('aggregates several groups and ungrouped artwork without counting a checked group twice', async () => {
    const first = await groupAt();
    const second = await groupAt(100);
    const lone = await addTestRectangle(adapter, 150, 50);
    const before = useStore.getState();
    const ui = await mountProperties(await nativeClient(), [first[0], first[1], second[0], lone]);
    expect(sizeInput('widthMm').value).toBe('160');
    expect(sizeInput('heightMm').value).toBe('70');
    submitResize();
    await ui.settle();
    expect(ui.writes).toHaveLength(1);
    expect(useStore.getState().project.scene.objects.map((object) => object.transform)).toEqual(
      before.project.scene.objects.map((object) => object.transform),
    );
  });

  it('uses the transitive group footprint for overlapping persistent memberships', async () => {
    const ids = await groupAt();
    const third = await addTestRectangle(adapter, 40);
    const state = useStore.getState();
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          groups: [
            ...state.project.scene.groups!,
            { id: 'overlap', name: 'private-group-name', objectIds: [ids[1], third] },
          ],
        },
      },
    });
    const before = useStore.getState();
    const ui = await mountProperties(await nativeClient(), [ids[0]]);
    expect(sizeInput('widthMm').value).toBe('50');
    expect(JSON.stringify(ui.workspace)).not.toContain('private-group-name');
    submitResize();
    await ui.settle();
    expect(useStore.getState().project.scene.objects).toEqual(before.project.scene.objects);
  });

  it('retains full numeric precision when unchanged dimensions are submitted', async () => {
    const result = await adapter.execute(
      'add_rectangle',
      writeArgs(adapter, {
        xMm: 0,
        yMm: 0,
        widthMm: 10.000123,
        heightMm: 20.000456,
      }),
    );
    expect(result.ok).toBe(true);
    const before = useStore.getState();
    const id = before.project.scene.objects[0]!.id;
    const ui = await mountProperties(await nativeClient(), [id]);
    expect(sizeInput('widthMm').value).toBe('10.000123');
    expect(sizeInput('heightMm').value).toBe('20.000456');
    submitResize();
    await ui.settle();
    expect(useStore.getState().project.scene.objects[0]!.transform).toEqual(
      before.project.scene.objects[0]!.transform,
    );
  });

  it('retains disabled controls when the native edit grant is absent', async () => {
    const ids = await groupAt();
    setWritable(false);
    const before = useStore.getState();
    const ui = await mountProperties(await nativeClient(), [ids[0]]);
    expect(sizeInput('widthMm').disabled).toBe(true);
    expect(resizeButton().disabled).toBe(true);
    submitResize();
    await ui.settle();
    expect(ui.writes).toEqual([]);
    expect(useStore.getState()).toBe(before);
  });

  it('keeps a local resize draft and refuses it after a newer native workspace is refreshed', async () => {
    const ids = await groupAt();
    const client = await nativeClient();
    const ui = await mountProperties(client, [ids[0]]);
    typeSize('widthMm', '60');
    await addTestRectangle(adapter, 100);
    const current = useStore.getState();
    ui.binding.refresh(await workspace(client));
    expect(sizeInput('widthMm').value).toBe('60');
    expect(resizeButton().disabled).toBe(true);
    expect(document.getElementById('authoring-conflict')!.hidden).toBe(false);
    submitResize();
    await ui.settle();
    expect(ui.writes).toEqual([]);
    expect(document.getElementById('message')!.textContent).toContain('PC selection changed');
    expect(useStore.getState()).toBe(current);
  });

  it('keeps the backend stale-revision refusal when an unseen PC edit races a resize', async () => {
    const ids = await groupAt();
    const ui = await mountProperties(await nativeClient(), [ids[0]]);
    typeSize('widthMm', '60');
    await addTestRectangle(adapter, 100);
    const current = useStore.getState();
    submitResize();
    await ui.settle();
    expect(ui.writes).toHaveLength(1);
    expect(document.getElementById('message')!.textContent).toBe('Native mutation rejected');
    expect(sizeInput('widthMm').value).toBe('60');
    expect(useStore.getState()).toBe(current);
  });
});
