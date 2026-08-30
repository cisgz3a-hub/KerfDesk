/** Creates the single terminal owner for one packaged native-smoke run. */
export function createNativeSmokeTerminalClaim(): () => boolean {
  let isClaimed = false;
  return () => {
    if (isClaimed) return false;
    isClaimed = true;
    return true;
  };
}
