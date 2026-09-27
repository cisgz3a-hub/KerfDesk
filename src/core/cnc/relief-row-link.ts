import type { CncPath3dPass } from '../job';

/** Restore the original independently entered row before a new placement. */
export function withoutReliefRowLink(pass: CncPath3dPass): CncPath3dPass {
  const { reliefRowLinkPrefixPoints, ...original } = pass;
  return reliefRowLinkPrefixPoints === undefined
    ? pass
    : { ...original, points: pass.points.slice(reliefRowLinkPrefixPoints) };
}
