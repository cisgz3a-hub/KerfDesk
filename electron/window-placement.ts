// Where the main window opens (ADR-482). A desktop app reopens where the
// operator left it; KerfDesk always opened at 1280 x 800 in the middle of the
// main screen. The last size, position and maximized state are kept in
// userData, and a saved place is used only while a screen still shows it, so
// a window left on a monitor that has since been unplugged opens on one that
// is there.

export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type SavedWindowPlacement = Rect & { readonly maximized: boolean };

export type WindowPlacement = {
  readonly bounds: Rect | { readonly width: number; readonly height: number };
  readonly maximized: boolean;
};

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 800 } as const;
/** The window's top strip must show this much on one screen to be grabbable. */
const VISIBLE_TITLE_WIDTH = 120;
const VISIBLE_TITLE_HEIGHT = 32;
const MIN_WINDOW_SIDE = 200;

export function parseSavedWindowPlacement(text: string): SavedWindowPlacement | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { x, y, width, height, maximized } = record;
  if (![x, y, width, height].every(isFiniteInteger) || typeof maximized !== 'boolean') return null;
  const size = { width: width as number, height: height as number };
  if (size.width < MIN_WINDOW_SIDE || size.height < MIN_WINDOW_SIDE) return null;
  return { x: x as number, y: y as number, ...size, maximized };
}

export function serializeWindowPlacement(placement: SavedWindowPlacement): string {
  const { x, y, width, height, maximized } = placement;
  return `${JSON.stringify({ x, y, width, height, maximized })}\n`;
}

/** The saved place when a screen still shows its title strip, else the default. */
export function restoredWindowPlacement(
  saved: SavedWindowPlacement | null,
  workAreas: ReadonlyArray<Rect>,
): WindowPlacement {
  if (saved === null) return { bounds: DEFAULT_WINDOW_SIZE, maximized: false };
  const area = workAreas.find((candidate) => showsTitleStrip(saved, candidate));
  if (area === undefined) {
    const fallback = workAreas[0];
    const size = fallback === undefined ? DEFAULT_WINDOW_SIZE : fitSize(saved, fallback);
    return { bounds: size, maximized: saved.maximized };
  }
  return {
    bounds: { x: saved.x, y: saved.y, ...fitSize(saved, area) },
    maximized: saved.maximized,
  };
}

function showsTitleStrip(window: Rect, area: Rect): boolean {
  const left = Math.max(window.x, area.x);
  const right = Math.min(window.x + window.width, area.x + area.width);
  const top = Math.max(window.y, area.y);
  const bottom = Math.min(window.y + VISIBLE_TITLE_HEIGHT, area.y + area.height);
  return right - left >= VISIBLE_TITLE_WIDTH && bottom - top >= VISIBLE_TITLE_HEIGHT;
}

function fitSize(window: Rect, area: Rect): { readonly width: number; readonly height: number } {
  return {
    width: Math.min(window.width, area.width),
    height: Math.min(window.height, area.height),
  };
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Math.abs(value) < 1_000_000;
}
