import { createCncPreviewWorkerClient } from './cnc-preview-worker-client-runtime';

export { isCncRemovalGridSuperseded } from './cnc-preview-worker-client-types';

const client = createCncPreviewWorkerClient();

/** Prepare a latest-only CNC removal grid away from the browser UI thread. */
export const prepareCncRemovalGridOffThread = (
  ...args: Parameters<typeof client.prepareGrid>
): ReturnType<typeof client.prepareGrid> => client.prepareGrid(...args);

/** Prepare a latest-only Cut 3D surface away from the browser UI thread. */
export const prepareCncCut3DSurfaceOffThread = (
  ...args: Parameters<typeof client.prepareSurface>
): ReturnType<typeof client.prepareSurface> => client.prepareSurface(...args);

/** Queue a cancellable batch of depth-map relief materializations in the shared worker lane. */
export const prepareReliefHeightmapsOffThread = (
  ...args: Parameters<typeof client.prepareReliefBatch>
): ReturnType<typeof client.prepareReliefBatch> => client.prepareReliefBatch(...args);

/** Materialize one depth-map relief in the shared preview worker. */
export const prepareReliefHeightmapOffThread = (
  ...args: Parameters<typeof client.prepareRelief>
): ReturnType<typeof client.prepareRelief> => client.prepareRelief(...args);

/** Reset the shared worker client and request sequence between isolated tests. */
export const resetCncRemovalGridWorkerForTests = (): void => client.resetForTests();
