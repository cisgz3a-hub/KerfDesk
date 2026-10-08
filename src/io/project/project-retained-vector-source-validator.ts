import { validatePartGeneratorSource } from './project-part-generator-validator';
import { validateConstrainedSketch } from './project-constrained-sketch-validator';

/** A materialized vector may retain one editable geometry authority. */
export function validateRetainedVectorSources(
  object: Record<string, unknown>,
  path: string,
): string | null {
  const retainedSources = ['partGenerator', 'constrainedSketch', 'booleanCompound'];
  if (retainedSources.filter((key) => object[key] !== undefined).length > 1)
    return path + ' has competing retained vector sources; bake one source first';
  return (
    validateConstrainedSketch(object['constrainedSketch']) ??
    validatePartGeneratorSource(object['partGenerator'])
  );
}
