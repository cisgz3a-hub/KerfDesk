// V8 cannot build a string longer than 536,870,888 characters (about 512 MB of
// project text; Node 25 / V8 14, the engine Chromium and Electron share).
// JSON.stringify past it throws RangeError "Invalid string length", which said
// nothing to the operator (rolling audit v5 J10-P3-3, ADR-204 Amendment 2).

export function isTextLengthLimitError(error: unknown): boolean {
  return error instanceof RangeError && /invalid string length/i.test(error.message);
}

export const PROJECT_TEXT_TOO_LARGE_REASON =
  'it is too large for one project file (the saved file would pass about 512 MB, the most ' +
  'this app can write in one piece); simplify dense imported artwork or split the work ' +
  'across projects';
