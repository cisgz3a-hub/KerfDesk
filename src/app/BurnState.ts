/**
 * Burn-progress tracking state shared by MachineService and its pure helpers.
 *
 * Keeping the shape outside MachineService prevents helper modules from
 * importing the service class just to reset an empty burn tracker.
 */
export interface BurnState {
  readonly activeIds: ReadonlySet<string>;
  readonly burnedIds: ReadonlySet<string>;
}

export type BurnStateListener = (state: BurnState) => void;
