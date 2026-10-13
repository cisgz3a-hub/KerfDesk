// Font Manager preferences (LightBurn): favourite fonts, fonts hidden from
// the list, the recently used ones and the specimen size. Kept per computer,
// like the other picker preferences, never in the project.

import { create } from 'zustand';

const KEY = 'lf2:font-preferences:v1';
const MAX_RECENT = 8;
export const SPECIMEN_SIZE_RANGE = { min: 12, max: 40, initial: 18 } as const;

type Saved = {
  readonly favourites: ReadonlyArray<string>;
  readonly hidden: ReadonlyArray<string>;
  readonly recent: ReadonlyArray<string>;
  readonly specimenPx: number;
};

type FontPreferences = Saved & {
  readonly toggleFavourite: (key: string) => void;
  readonly toggleHidden: (key: string) => void;
  readonly markUsed: (key: string) => void;
  readonly setSpecimenPx: (px: number) => void;
};

export const useFontPreferences = create<FontPreferences>((set, get) => {
  const update = (patch: Partial<Saved>): void => {
    set(patch);
    const { favourites, hidden, recent, specimenPx } = get();
    write({ favourites, hidden, recent, specimenPx });
  };
  const toggle = (list: ReadonlyArray<string>, key: string) =>
    list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
  return {
    ...read(),
    toggleFavourite: (key) => update({ favourites: toggle(get().favourites, key) }),
    toggleHidden: (key) => update({ hidden: toggle(get().hidden, key) }),
    markUsed: (key) =>
      update({
        recent: [key, ...get().recent.filter((entry) => entry !== key)].slice(0, MAX_RECENT),
      }),
    setSpecimenPx: (px) =>
      update({
        specimenPx: Math.min(
          SPECIMEN_SIZE_RANGE.max,
          Math.max(SPECIMEN_SIZE_RANGE.min, Math.round(px)),
        ),
      }),
  };
});

function strings(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function read(): Saved {
  const fallback: Saved = {
    favourites: [],
    hidden: [],
    recent: [],
    specimenPx: SPECIMEN_SIZE_RANGE.initial,
  };
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const px = parsed['specimenPx'];
    return {
      favourites: strings(parsed['favourites']),
      hidden: strings(parsed['hidden']),
      recent: strings(parsed['recent']).slice(0, MAX_RECENT),
      specimenPx:
        typeof px === 'number' && px >= SPECIMEN_SIZE_RANGE.min && px <= SPECIMEN_SIZE_RANGE.max
          ? px
          : SPECIMEN_SIZE_RANGE.initial,
    };
  } catch {
    return fallback;
  }
}

function write(saved: Saved): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Storage may be full or blocked; the choices still hold for this session.
  }
}
