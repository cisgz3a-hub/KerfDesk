import type { Scene } from '../core/scene/Scene';
import { installDebugStateGraph } from './StateGraph';

interface RefLike<T> {
  current: T;
}

export function installAppDebugStateGraph(args: {
  sceneRef: RefLike<Scene>;
  selectedIdsRef: RefLike<ReadonlySet<string>>;
  hashScene: (scene: Scene) => string;
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
  });
}
