import { store } from './store';
import { RemoteError, type RemoteTransport } from './transport';

export async function readCameraSnapshot(
  transport: RemoteTransport,
  current: () => boolean = () => true,
): Promise<void> {
  try {
    const result = await transport.call<{
      status: string;
      message?: string;
      image?: { data: string; widthPx: number; heightPx: number };
    }>('get_camera_snapshot');
    if (!current()) return;
    if (result.image === undefined) {
      store.toast(result.message ?? 'The camera isn’t available.', 'warning');
      return;
    }
    store.set({
      camera: {
        data: result.image.data,
        width: result.image.widthPx,
        height: result.image.heightPx,
        at: Date.now(),
      },
    });
  } catch (error) {
    if (!current()) return;
    store.toast(
      error instanceof RemoteError ? error.message : 'The camera isn’t available.',
      'error',
    );
  }
}
