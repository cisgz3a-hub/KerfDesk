import type { CncGroup } from '../job/job';

export type CncSpindleState = {
  isMultiTool: boolean;
  currentRpm: number;
  currentToolKey: string;
};

/** One transition decision shared by emitted commands and deterministic
 * dwell timing. A changed delay alone does not restart an unchanged spindle. */
export function cncSpindleTransition(
  group: CncGroup,
  state: CncSpindleState,
): 'tool-change' | 'rpm-change' | 'none' {
  if (state.isMultiTool && (group.toolId ?? '') !== state.currentToolKey) return 'tool-change';
  return group.spindleRpm !== state.currentRpm ? 'rpm-change' : 'none';
}
