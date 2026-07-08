// board-capture constants shared across the panel's phases (ADR-124).

// Below this in either dimension a board is a mis-capture or a typo, not a real
// board — `createRegistrationBox`'s sanitizeSize would silently clamp it to
// 1 mm, so both the measured and the manual-size paths block it instead.
export const MIN_BOARD_DIMENSION_MM = 3;
