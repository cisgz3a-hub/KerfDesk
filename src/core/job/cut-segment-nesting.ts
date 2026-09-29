import type { ColoredPath } from '../scene';
import { carriedSubpathDepths } from '../scene/subpath-nesting';
import type { CutSegment } from './job';

// The nesting a subpath's segment carries, from the path's valid forest only.
export function segmentNesting(
  path: ColoredPath,
  forest: string,
): (subpathIndex: number) => CutSegment['nesting'] {
  const depths = carriedSubpathDepths(path);
  if (depths === null) return () => undefined;
  return (subpathIndex) => {
    const depth = depths[subpathIndex];
    return depth === undefined ? undefined : { forest, depth };
  };
}
