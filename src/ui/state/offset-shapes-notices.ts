// The Offset Shapes notice for sources that got no inward ring (ADR-410
// Amendment 6, tools audit T1 T33-P2-2). The dialog shows it before Apply and
// the action repeats it as a toast, so a shape that leaves the burn is named.

import type { VectorSceneObject } from '../../core/geometry';
import { sourcesWithoutInwardOffset } from '../../core/geometry/offset-shapes-coverage';
import type { ImportedSvg } from '../../core/scene';
import type { OffsetShapesRequest } from './offset-shapes-actions';

const NAMED_LIMIT = 3;

/** Empty when every source has an inward ring of its own, or none was asked for. */
export function offsetNoInwardNotice(
  sources: ReadonlyArray<VectorSceneObject>,
  inward: ImportedSvg | null,
  request: Pick<OffsetShapesRequest, 'direction' | 'distanceMm' | 'deleteOriginals'>,
): string {
  // A whole collapse under Both has its own notice ("Only the outward…").
  if (request.direction === 'outward' || (request.direction === 'both' && inward === null))
    return '';
  const lost = sourcesWithoutInwardOffset(sources, inward, request.distanceMm);
  if (lost.length === 0) return '';
  const names = lost.slice(0, NAMED_LIMIT).map(sourceLabel);
  const more = lost.length > NAMED_LIMIT ? ` and ${lost.length - NAMED_LIMIT} more` : '';
  const count = lost.length === 1 ? 'One shape gets' : `${lost.length} shapes get`;
  const head = `${count} no inward offset (too small or not closed for ${request.distanceMm} mm): ${names.join(', ')}${more}.`;
  return [head, deletedTail(request, lost.length === 1)].filter((part) => part !== '').join(' ');
}

// What Delete original objects does to those shapes.
function deletedTail(
  request: Pick<OffsetShapesRequest, 'direction' | 'deleteOriginals'>,
  one: boolean,
): string {
  if (!request.deleteOriginals) return '';
  if (request.direction === 'both')
    return `${one ? 'It keeps' : 'They keep'} only the outward offset.`;
  const [it, its] = one ? ['it', 'its'] : ['them', 'their'];
  return `Delete original objects removes ${it} with nothing in ${its} place; Undo brings ${it} back.`;
}

function sourceLabel(object: VectorSceneObject): string {
  const name = object.name?.trim();
  if (name !== undefined && name !== '') return `“${name}”`;
  if (object.kind === 'imported-svg') return 'a path';
  return `a ${object.kind.replace(/-/g, ' ')}`;
}
