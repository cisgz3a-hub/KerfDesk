import type { FramedRunPermit } from './framed-run';
import type { LaserState } from './laser-store';

type SetFn = (partial: Partial<LaserState>) => void;
type GetFn = () => LaserState;

export function consumeClaimedFramedRun(
  set: SetFn,
  get: GetFn,
  permit: FramedRunPermit | undefined,
): void {
  if (permit === undefined) return;
  if (get().framedRun !== permit) {
    throw new Error(
      'The completed Frame permit changed at the final Start boundary. Frame the exact job again.',
    );
  }
  // The one-run permit is consumed here, but the completed Frame verification
  // remains the strict compatibility proof used by checkpoint/manual recovery
  // and completed replay preparation. Physical/setup mutations own its
  // invalidation independently; consuming Start authorization is not one.
  set({ framedRun: null });
}
