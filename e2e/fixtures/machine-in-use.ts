import type { DeviceProfile } from '../../src/core/devices';
import type { Page } from './kerfdesk-test';

/**
 * Change the machine in use as Machine Setup does, and leave the document clean
 * so the next Open replaces it without asking to save. A file opened for the
 * same machine (profile id, name and bed size) keeps the machine in use, not
 * the file's copy of it (ADR-500 Amendment 2), so a spec that needs homing, air
 * assist or a rotary sets it here before it opens its file.
 */
export async function useMachineInUse(page: Page, patch: Partial<DeviceProfile>): Promise<void> {
  await page.evaluate(async (devicePatch) => {
    const storePath = '/src/ui/state/store.ts';
    const { useStore } = await import(/* @vite-ignore */ storePath);
    useStore.getState().updateDeviceProfile(devicePatch);
    useStore.setState({ dirty: false });
  }, patch);
}
