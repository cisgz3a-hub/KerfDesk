import type { FramedRunPermit } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';

/** One synchronous owner for the exact completion-issued permit being handed
 * from the UI flow to the controller store. */
export type FramedRunStartClaim = {
  readonly permit: FramedRunPermit;
};

let activeClaim: FramedRunStartClaim | null = null;

export function claimCurrentFramedRunStart(permit: FramedRunPermit): FramedRunStartClaim | null {
  if (activeClaim !== null || useLaserStore.getState().framedRun !== permit) return null;
  const claim = { permit };
  activeClaim = claim;
  return claim;
}

export function framedRunStartClaimIsCurrent(claim: FramedRunStartClaim): boolean {
  return activeClaim === claim && useLaserStore.getState().framedRun === claim.permit;
}

export function releaseFramedRunStartClaim(claim: FramedRunStartClaim): void {
  if (activeClaim === claim) activeClaim = null;
}
