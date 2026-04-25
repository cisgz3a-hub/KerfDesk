/**
 * GRBL line literals used only for user-command classification in the connection
 * UI (`classifyUserCommand` / CommandClassifier). Substrings live in core so `src/ui`
 * stays free of raw gcode (see `tests/no-gcode-in-ui.test.ts`).
 */
export const GRBL_USER_LINE_FOR_UNLOCK_CLASSIFY = '$X' as const;
