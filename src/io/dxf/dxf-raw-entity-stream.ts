import type { RawEntity } from './dxf-expand';
import type { DxfTag } from './dxf-tags';

export type RawEntityStream = {
  readonly pushTag: (tag: DxfTag) => void;
  readonly finish: () => void;
};

export function createRawEntityStream(onEntity: (entity: RawEntity) => void): RawEntityStream {
  let currentType: string | null = null;
  let currentTags: DxfTag[] = [];
  let polylineTags: DxfTag[] | null = null;
  let vertexRuns: DxfTag[][] = [];

  const emitCurrent = (): void => {
    if (currentType === null) return;
    onEntity({ type: currentType, tags: currentTags, vertexRuns: [] });
    currentType = null;
    currentTags = [];
  };

  const emitPolyline = (): void => {
    if (polylineTags === null) return;
    if (currentType === 'VERTEX') vertexRuns.push(currentTags);
    onEntity({ type: 'POLYLINE', tags: polylineTags, vertexRuns });
    polylineTags = null;
    vertexRuns = [];
    currentType = null;
    currentTags = [];
  };

  const beginRun = (type: string): void => {
    if (polylineTags !== null) {
      if (type === 'VERTEX') {
        if (currentType === 'VERTEX') vertexRuns.push(currentTags);
        currentType = 'VERTEX';
        currentTags = [];
        return;
      }
      emitPolyline();
      if (type === 'SEQEND') return;
    } else {
      emitCurrent();
    }
    if (type === 'POLYLINE') {
      polylineTags = [];
      return;
    }
    currentType = type;
    currentTags = [];
  };

  const pushTag = (tag: DxfTag): void => {
    if (tag.code === 0) {
      beginRun(tag.value.toUpperCase());
      return;
    }
    if (polylineTags !== null && currentType === null) polylineTags.push(tag);
    else currentTags.push(tag);
  };

  const finish = (): void => {
    if (polylineTags !== null) emitPolyline();
    else emitCurrent();
  };

  return { pushTag, finish };
}
