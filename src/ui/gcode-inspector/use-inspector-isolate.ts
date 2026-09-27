// Inspector state for isolating part of the job (ADR-470). Legend filters
// belong to the lens they were set in and the Z range and section to the
// program, so a new lens or a new program starts with everything shown. The
// legend's Traversal swatch is the existing traversal toggle, not a second
// switch for the same moves.

import { useMemo, useState } from 'react';
import type { ProgramTimeModel } from '../../core/gcode-time';
import type { GcodeRenderModel } from '../../core/gcode-view';
import { isolatePlanes, moveFilterMask, NO_ISOLATE, type IsolateState } from './isolate';
import { lensEntries, type LensId } from './lenses';
import type { ToolSections } from './tool-sections';

const NOTHING_HIDDEN: ReadonlySet<number> = new Set();

export function useInspectorIsolate(args: {
  readonly model: GcodeRenderModel;
  readonly time: ProgramTimeModel;
  readonly lens: LensId;
  readonly sections: ToolSections | null;
  readonly travelVisible: boolean;
  readonly setTravelVisible: (visible: boolean) => void;
}) {
  const { model, time, lens, sections, travelVisible } = args;
  const [filter, setFilter] = useState({ model, lens, hidden: NOTHING_HIDDEN });
  const [isolateFor, setIsolateFor] = useState({ model, state: NO_ISOLATE });
  const hidden = filter.model === model && filter.lens === lens ? filter.hidden : NOTHING_HIDDEN;
  const isolate = isolateFor.model === model ? isolateFor.state : NO_ISOLATE;
  const entries = useMemo(
    () => lensEntries(model, time, lens, sections),
    [model, time, lens, sections],
  );
  const moveFilter = useMemo(
    () => (entries === null ? null : moveFilterMask(model.segmentCount, entries.entryOf, hidden)),
    [model.segmentCount, entries, hidden],
  );
  const clipPlanes = useMemo(() => isolatePlanes(isolate), [isolate]);
  const travelEntry = entries?.travel ?? null;
  const legendHidden = useMemo(() => {
    if (travelEntry === null || travelVisible) return hidden;
    return new Set([...hidden, travelEntry]);
  }, [hidden, travelEntry, travelVisible]);
  return {
    /** Legend entries drawn switched off, the traversal toggle included. */
    legendHidden,
    /** Null for ramp lenses, whose legend has no entries to switch. */
    toggleEntry:
      entries === null
        ? null
        : (entry: number): void => {
            if (entry === travelEntry) {
              args.setTravelVisible(!travelVisible);
              return;
            }
            const next = new Set(hidden);
            if (!next.delete(entry)) next.add(entry);
            setFilter({ model, lens, hidden: next });
          },
    moveFilter,
    isolate,
    setIsolate: (state: IsolateState): void => setIsolateFor({ model, state }),
    clipPlanes,
  };
}
