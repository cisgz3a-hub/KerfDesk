import { createRemoteControlAdapter } from './adapter';
import { useStore } from '../state/store';
import type {
  RemoteControlAdapter,
  RemoteCommandResult,
  RemoteControlOptions,
  WriteAdmission,
} from './types';

export function testAdapter(options: Partial<RemoteControlOptions> = {}): RemoteControlAdapter {
  return createRemoteControlAdapter({
    getAppStatus: () => ({
      app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
      edition: { mode: 'free' },
      updates: { available: false },
    }),
    canWrite: () => true,
    ...options,
  });
}
export function writeArgs(
  adapter: RemoteControlAdapter,
  values: Record<string, unknown> = {},
): WriteAdmission & Record<string, unknown> {
  return { expectedRevision: adapter.getRevision(), requestId: crypto.randomUUID(), ...values };
}
export function resultCode(result: RemoteCommandResult): string {
  return result.ok ? 'ok' : result.error.code;
}
export async function addTestRectangle(adapter: RemoteControlAdapter, xMm = 0, yMm = 0) {
  const result = await adapter.execute(
    'add_rectangle',
    writeArgs(adapter, { xMm, yMm, widthMm: 10, heightMm: 20 }),
  );
  if (!result.ok) throw new Error('Fixture rectangle creation failed.');
  const object = useStore.getState().project.scene.objects.at(-1);
  if (object === undefined) throw new Error('Fixture rectangle missing.');
  return object.id;
}
