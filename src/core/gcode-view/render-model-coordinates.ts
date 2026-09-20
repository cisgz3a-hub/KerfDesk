import { parseGrblCncCoordinate } from '../cnc/coordinate-representation';
import type { RenderModal } from './render-model-words';

export function grblCoordinateWord(letter: string, text: string): number {
  return 'XYZIJR'.includes(letter) ? parseGrblCncCoordinate(text) : Number.parseFloat(text);
}

export function resolveTarget(
  modal: RenderModal,
  words: ReadonlyMap<string, number>,
): { x: number; y: number; z: number } {
  const axis = (name: string, current: number): number => {
    const raw = words.get(name);
    if (raw === undefined) return current;
    const scaled = raw * modal.unitScale;
    return modal.absolute ? scaled : current + scaled;
  };
  return { x: axis('X', modal.x), y: axis('Y', modal.y), z: axis('Z', modal.z) };
}
