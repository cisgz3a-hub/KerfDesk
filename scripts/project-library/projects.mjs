// The bundled project set. One module per subject area so no single file
// approaches the 400-line source cap as the library grows; this barrel is the
// only thing the generator imports.

import { DESK_PROJECTS } from './projects/desk.mjs';
import { STORAGE_PROJECTS } from './projects/storage.mjs';
import { WORKSHOP_PROJECTS } from './projects/workshop.mjs';

export const ALL_PROJECTS = [...STORAGE_PROJECTS, ...DESK_PROJECTS, ...WORKSHOP_PROJECTS];
