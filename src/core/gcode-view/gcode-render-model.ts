import { iterateLines } from '../util';
import { createGcodeRenderModelBuilder } from './gcode-render-model-builder';
import type { BuildRenderModelOptions, BuildRenderModelResult } from './render-model-types';

export function buildGcodeRenderModel(
  text: string,
  options: BuildRenderModelOptions = {},
): BuildRenderModelResult {
  const builder = createGcodeRenderModelBuilder(options);
  for (const line of iterateLines(text)) builder.pushLine(line);
  return builder.finish();
}
