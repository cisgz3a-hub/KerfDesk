import type { Scene } from '../core/scene/Scene';
import { installDebugStateGraph } from './StateGraph';

interface RefLike<T> {
  current: T;
}

/** Subset of LaserController the debug graph reads. Optional methods so
 *  unknown / non-GRBL controllers don't fail the type contract. */
interface ControllerForDebugSnapshot {
  readonly family?: string;
  readonly state?: { readonly status?: string };
  getDeviceIdentity?(): unknown;
  getUnsafeAtConnect?(): unknown;
}

export function installAppDebugStateGraph(args: {
  sceneRef: RefLike<Scene>;
  selectedIdsRef: RefLike<ReadonlySet<string>>;
  hashScene: (scene: Scene) => string;
  /** Optional: when supplied, the debug graph also exposes a `device`
   *  snapshot containing the live `getDeviceIdentity()` (T3-50) and
   *  `getUnsafeAtConnect()` (T1-25) outputs. Production code paths
   *  pass this; tests that don't care about the device surface omit
   *  it. */
  controllerRef?: RefLike<ControllerForDebugSnapshot | null>;
}): boolean {
  return installDebugStateGraph({
    project: {
      getSnapshot: () => {
        const current = args.sceneRef.current;
        return {
          sceneHash: args.hashScene(current),
          objectCount: current.objects.length,
          layerCount: current.layers.length,
          activeLayerId: current.activeLayerId,
        };
      },
    },
    editor: {
      getSnapshot: () => ({
        selectionCount: args.selectedIdsRef.current.size,
      }),
    },
    device: {
      getSnapshot: () => {
        const ctrl = args.controllerRef?.current;
        if (ctrl == null) return { connected: false };
        return {
          connected: true,
          family: ctrl.family ?? null,
          status: ctrl.state?.status ?? null,
          identity: typeof ctrl.getDeviceIdentity === 'function'
            ? ctrl.getDeviceIdentity()
            : null,
          unsafeAtConnect: typeof ctrl.getUnsafeAtConnect === 'function'
            ? ctrl.getUnsafeAtConnect()
            : null,
        };
      },
    },
  });
}
