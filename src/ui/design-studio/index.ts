// ui/design-studio — the full-window on-canvas design surface (ADR-272,
// Phase N). App mounts the host and opens it through the boot shell; the session
// store and everything else are internal to the lazy chunks (Amendment 9).

export { DesignStudioHost } from './DesignStudioHost';
export { openDesignStudio } from './design-studio-open';
