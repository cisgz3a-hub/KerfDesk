/**
 * T1-230 compatibility wrapper.
 *
 * `SafetyActionResult` is controller-owned safety vocabulary. The canonical
 * implementation moved to `src/controllers/SafetyActionResult.ts`; this app
 * path remains so older app/UI/tests imports do not break in the same slice.
 */
export * from '../controllers/SafetyActionResult';

