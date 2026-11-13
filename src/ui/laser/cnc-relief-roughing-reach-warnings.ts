// Job Review note for relief stock the roughing bit could not reach (rolling
// audit v11 W6-P2-2). Roughing used to leave such a region at full stock and
// the finishing ball slotted it at full depth with nothing said; compile now
// steps the finishing bit down there (relief-finishing-step-down.ts) and this
// note names the region, what cuts it and how to cut it faster. Advisory only
// (rule 7): it never alters or refuses the plan.

import type { Job } from '../../core/job';
import type { Project } from '../../core/scene';

type CncReliefPlan = NonNullable<NonNullable<Job['cncCompilation']>['reliefPlans']>[number];

export function reliefRoughingReachWarnings(
  project: Project,
  plans: ReadonlyArray<CncReliefPlan>,
): ReadonlyArray<string> {
  return plans.flatMap((plan) => {
    if (plan.stage === 'rest-finishing') return restReachWarnings(project, plan);
    if (plan.stage !== 'roughing') return [];
    const where = `Relief "${plan.source}" on layer "${layerName(project, plan.layerId)}"`;
    if (plan.roughingReachUnchecked === true) {
      return [
        `${where}: the check for stock the ${plan.toolDiameterMm} mm roughing bit cannot ` +
          'reach exceeded its work budget, so such stock is not reported and the finishing bit ' +
          'is not stepped down there. Check the 3D preview after roughing before finishing.',
      ];
    }
    const areaMm2 = plan.roughingMissedAreaMm2;
    if (areaMm2 === undefined || areaMm2 <= 0) return [];
    const missed =
      `${where}: the ${plan.toolDiameterMm} mm roughing bit cannot reach about ` +
      `${Math.max(1, Math.round(areaMm2))} mm² of the relief and leaves it more than one ` +
      'depth per pass above the finished surface.';
    const finishing = plans.find(
      (other) =>
        other.stage === 'finishing' &&
        other.layerId === plan.layerId &&
        other.targetObjectId === plan.targetObjectId,
    );
    if (finishing === undefined) {
      return [
        `${missed} No finishing bit is set, so that stock stays uncut. Use a smaller roughing bit.`,
      ];
    }
    const levels = finishing.finishingStepLevels ?? 0;
    if (levels === 0) {
      return [
        `${missed} The ${bitName(finishing)} finishing bit does not step down ` +
          'there either. Check the 3D preview, or use a smaller roughing bit.',
      ];
    }
    return [
      `${missed} The ${bitName(finishing)} finishing bit cuts it first in ` +
        `${levels} step-down ${levels === 1 ? 'level' : 'levels'} of one depth per pass, at the ` +
        'finishing feed, before its finishing pass. A smaller roughing bit clears it faster.',
    ];
  });
}

// Rolling audit v12 X6-P2-2: the finishing bit's own misses, which the rest
// bit steps down through before its rest rows.
function restReachWarnings(project: Project, plan: CncReliefPlan): ReadonlyArray<string> {
  const where = `Relief "${plan.source}" on layer "${layerName(project, plan.layerId)}"`;
  if (plan.predecessorReachUnchecked === true) {
    return [
      `${where}: the check for stock the finishing bit cannot reach exceeded its work budget, ` +
        `so the ${bitName(plan)} rest bit is not stepped down there. Check the 3D ` +
        'preview after finishing before rest finishing.',
    ];
  }
  const areaMm2 = plan.predecessorMissedAreaMm2;
  if (areaMm2 === undefined || areaMm2 <= 0) return [];
  const levels = plan.finishingStepLevels ?? 0;
  const cut =
    levels > 0
      ? `The ${bitName(plan)} rest bit cuts it first in ${levels} step-down ` +
        `${levels === 1 ? 'level' : 'levels'} of one depth per pass, at its own feed, before its ` +
        'rest rows.'
      : `The ${bitName(plan)} rest bit does not step down there. Check the 3D preview.`;
  return [
    `${where}: the finishing bit cannot reach about ${Math.max(1, Math.round(areaMm2))} mm² ` +
      `of the relief and leaves it more than one depth per pass above the finished surface. ${cut}`,
  ];
}

// CNC audit v3 N2-P2-1: a narrowing bit is named by kind and tip, since its
// nominal diameter (the widest cut) is not what rides in the band.
function bitName(plan: CncReliefPlan): string {
  if (plan.toolKind === 'tapered-ball-nose' && plan.toolTipDiameterMm !== undefined)
    return `${plan.toolTipDiameterMm} mm-tip tapered ball`;
  if (plan.toolKind === 'v-bit') return `${plan.toolDiameterMm} mm V-bit`;
  if (plan.toolKind === 'engraving') return `${plan.toolDiameterMm} mm engraving bit`;
  return `${plan.toolDiameterMm} mm`;
}

function layerName(project: Project, layerId: string): string {
  return project.scene.layers.find((layer) => layer.id === layerId)?.name ?? layerId;
}
