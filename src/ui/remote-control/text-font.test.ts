import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteControlAdapter } from './adapter';
import { useStore } from '../state/store';
import { deserializeProject, serializeProject } from '../../io/project';
import { transformedBBox } from '../../core/scene/hit-test';
import type { RemoteControlAdapter } from './types';

// Only replace asset transport: use the actual bundled font, geometry renderer and store.
vi.mock('../text/font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Roboto-Regular.ttf')).buffer;
  },
}));
let adapter: RemoteControlAdapter | undefined;
afterEach(() => adapter?.dispose());
describe('real font geometry remains a normal saveable document edit', () => {
  it.each([0.5, 450])(
    'retains requested %s mm typography through codec and Undo',
    async (fontSizeMm) => {
      useStore.setState(useStore.getInitialState(), true);
      adapter = createRemoteControlAdapter({
        canWrite: () => true,
        getAppStatus: () => ({
          app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
          edition: { mode: 'free' },
          updates: { available: false },
        }),
      });
      const result = await adapter.execute('add_text', {
        expectedRevision: adapter.getRevision(),
        requestId: crypto.randomUUID(),
        text: 'AB café',
        xMm: -5,
        yMm: 15,
        widthMm: 40,
        fontSizeMm,
      });
      expect(result.ok).toBe(true);
      const project = useStore.getState().project;
      const object = project.scene.objects[0]!;
      expect(object).toMatchObject({ kind: 'text', sizeMm: fontSizeMm, content: 'AB café' });
      const bounds = transformedBBox(object);
      expect(bounds.minX).toBeCloseTo(-5);
      expect(bounds.minY).toBeCloseTo(15);
      expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual(40.00000001);
      expect(object.transform.scaleX).toBeLessThanOrEqual(1);
      expect(object.transform.scaleX).toBe(object.transform.scaleY);
      const decoded = deserializeProject(serializeProject(project));
      expect(decoded.kind).toBe('ok');
      if (decoded.kind === 'ok')
        expect(decoded.project.scene.objects[0]).toMatchObject({ sizeMm: fontSizeMm });
      useStore.getState().undo();
      expect(useStore.getState().project.scene.objects).toHaveLength(0);
    },
  );
});
