import { type Scene } from '../../../src/core/scene/Scene';
import { expandTextOutlinesForCompile } from '../../../src/geometry/expandTextForCompile';

/**
 * Same pre-compile step as production (`PipelineService.compileGcode`):
 * attaches vector outlines to text objects so `compileJob` can flatten them.
 * `JobCompiler` does **not** auto-convert raw text; outlines come from here.
 */
export async function prepareSceneForCompile(scene: Scene): Promise<Scene> {
  const { scene: expanded } = await expandTextOutlinesForCompile(scene);
  return expanded;
}
