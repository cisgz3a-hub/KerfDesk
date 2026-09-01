// Narrow public surface for the exact helical motion shared with emitters.
// The legacy core/job barrel is frozen by the public-export no-growth ratchet.
export {
  cncHelicalContourCanEmit,
  cncHelicalContourPoints,
  cncHelicalContourRepresentedSeams,
  cncHelicalContourRepresentedSeamZs,
} from '../cnc-helical-representation';
export type { CncHelicalContourPass } from '../job';
