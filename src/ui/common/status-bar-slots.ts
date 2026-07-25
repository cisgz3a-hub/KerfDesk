// Named mount points the StatusBar publishes for status text that is produced
// elsewhere in the tree. The canvas motion overlay owns the machine-status
// message but must not draw it over the drawing area, and its producer (the
// workspace) and consumer (the bottom bar) are unrelated branches — an id-based
// portal target is the seam that avoids duplicating the overlay pipeline or
// hoisting it into the app shell.
export const CANVAS_MOTION_SLOT_ID = 'lf-status-canvas-motion-slot';
