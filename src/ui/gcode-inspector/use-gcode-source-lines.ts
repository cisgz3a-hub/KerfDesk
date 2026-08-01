import { useEffect, useState } from 'react';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import { readGcodeSourceLines, type GcodeSourceLineIndex } from './gcode-source-line-index';

export type GcodeSourceLineWindow = {
  readonly first: number;
  readonly last: number;
  readonly lines: ReadonlyArray<string>;
  readonly error: string | null;
};

export function useGcodeSourceLines(
  source: GcodeInspectionSource,
  sourceIndex: GcodeSourceLineIndex,
  first: number,
  last: number,
): GcodeSourceLineWindow {
  const [loaded, setLoaded] = useState<GcodeSourceLineWindow | null>(null);

  useEffect(() => {
    let current = true;
    setLoaded(null);
    void readGcodeSourceLines(source, sourceIndex, first, last).then(
      (lines) => {
        if (current) setLoaded({ first, last, lines, error: null });
      },
      (error: unknown) => {
        if (!current) return;
        setLoaded({
          first,
          last,
          lines: [],
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => {
      current = false;
    };
  }, [first, last, source, sourceIndex]);

  if (loaded?.first === first && loaded.last === last) return loaded;
  return { first, last, lines: [], error: null };
}
