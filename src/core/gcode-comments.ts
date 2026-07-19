// Inline marker emitted only on intentional laser-off feed motion. Preflight
// uses this narrow semantic tag to distinguish generated seeks/runways from an
// unmarked stale G1 S0 move that could crawl across artwork.
export const INTENTIONAL_LASER_OFF_MOTION_COMMENT = 'kerfdesk:laser-off-motion';
