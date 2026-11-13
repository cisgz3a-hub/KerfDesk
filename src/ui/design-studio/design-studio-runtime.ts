// design-studio-runtime — the Design Studio's session code, fetched on the first
// Open (ADR-272 Amendment 9) rather than in every first download.
//
// Importing it loads the session store, which registers itself with the boot
// shell (design-studio-shell.ts), and starts saving the drawing for recovery.
// Saving starts here, before any session opens, so the first opened drawing is
// saved exactly as it was when the workspace mounted this on boot. It runs for
// the rest of the page's life, as the always-mounted host's hook did; page
// teardown still flushes through its pagehide listener.

import './design-studio-store';
import { startDesignSessionPersistence } from './use-design-session-persistence';

startDesignSessionPersistence();
