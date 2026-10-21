// Whether a commercial desktop build opens behind its licence window (ADR-623).
// Held off by ADR-623 Amendment 3: while this is false the desktop app opens
// straight into KerfDesk Free, as 1.0.20 did (ADR-540), and a trial or licence
// unlocks Pro from Help > Licence or a Pro prompt. Setting it to true turns the
// window back on everywhere at once: the renderer, the main process, its
// messages and the release checks all read this one value. It imports nothing.
export const DESKTOP_LICENCE_WINDOW = false;
