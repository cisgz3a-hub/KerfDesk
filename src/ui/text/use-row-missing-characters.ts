import { useEffect, useState } from 'react';
import type { TextStyle } from '../../core/scene/text-settings';
import { fontMissingCharacters } from './use-missing-characters';
import { useTextWorkerSession } from './use-text-worker-session';
import type { DialogValues } from './use-text-dialog-fields';

const CHECK_DELAY_MS = 100;

/**
 * ADR-591 Amendment 1. The characters of the previewed records that the text's font has no glyph
 * for, checked once per page of rows, so the rows preview never shows a glyph the burn lacks.
 * Null until checked, or when there is no text font to check against.
 */
export function useRowMissingCharacters(
  values: ReadonlyArray<string>,
  text: DialogValues | undefined,
): ReadonlySet<string> | null {
  const [missing, setMissing] = useState<ReadonlySet<string> | null>(null);
  // Its own session: the row layouts' renders would supersede this check (ADR-643).
  const textWorker = useTextWorkerSession();
  const characters = [...new Set(values.map((value) => asBurned(value, text?.textStyle)).join(''))]
    .filter((character) => character !== '\n')
    .join('');
  const fontKey = text?.fontKey;
  const embeddedFonts = text?.embeddedFonts;
  useEffect(() => {
    setMissing(null);
    if (fontKey === undefined || characters === '') return undefined;
    let current = true;
    const timer = window.setTimeout(() => {
      void fontMissingCharacters(textWorker, fontKey, embeddedFonts ?? [], characters).then(
        (found) => {
          if (current) setMissing(new Set(found));
        },
        // A font that cannot load or a failed worker leaves the rows unmarked; the text editor's
        // own hint reports either.
        () => undefined,
      );
    }, CHECK_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [characters, fontKey, embeddedFonts, textWorker]);
  return missing;
}

/** The record's characters the font lacks, once each, as the burn lays them out. */
export function recordMissingCharacters(
  value: string,
  missing: ReadonlySet<string>,
  style: TextStyle | undefined,
): ReadonlyArray<string> {
  return [...new Set(asBurned(value, style))].filter((character) => missing.has(character));
}

/** Whether a character of the record, as typed, burns as the font's box or nothing. */
export function burnsWithoutGlyph(
  character: string,
  missing: ReadonlySet<string>,
  style: TextStyle | undefined,
): boolean {
  return [...asBurned(character, style)].some((burned) => missing.has(burned));
}

// Upper case changes the characters laid out; right-to-left only reorders them.
function asBurned(value: string, style: TextStyle | undefined): string {
  return style?.uppercase === true ? value.toLocaleUpperCase() : value;
}
