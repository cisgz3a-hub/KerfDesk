import type { FramedRunPermit, FramedRunStartClaim } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';

export type { FramedRunStartClaim } from '../state/framed-run';

export function claimCurrentFramedRunStart(permit: FramedRunPermit): FramedRunStartClaim | null {
  const claim = { permit };
  useLaserStore.setState((state) =>
    state.framedRunStartClaim === null && state.framedRun === permit
      ? { framedRunStartClaim: claim }
      : {},
  );
  return useLaserStore.getState().framedRunStartClaim === claim ? claim : null;
}

export function framedRunStartClaimIsCurrent(claim: FramedRunStartClaim): boolean {
  const state = useLaserStore.getState();
  return state.framedRunStartClaim === claim && state.framedRun === claim.permit;
}

export function releaseFramedRunStartClaim(claim: FramedRunStartClaim): void {
  useLaserStore.setState((state) =>
    state.framedRunStartClaim === claim ? { framedRunStartClaim: null } : {},
  );
}
