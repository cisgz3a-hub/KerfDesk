import type { BoxFace, BoxJoineryParams, BoxJointMetricsV2 } from './joineryTypes';
import { createBoxJoineryModel } from './panelModel';
import { computeBoxJointMetricsV2 } from './jointPattern';
import { renderBoxJoineryFaces, validateBoxJoineryModel } from './boxJoineryEngine';

export type { BoxFace, BoxJoineryParams, BoxJointMetricsV2 } from './joineryTypes';
export { createBoxJoineryModel } from './panelModel';
export { computeBoxJointMetricsV2 } from './jointPattern';
export { validateBoxJoineryModel, getJointDebugFeatures } from './boxJoineryEngine';

export interface BoxGenerationValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateBoxGenerationParams(params: BoxJoineryParams): BoxGenerationValidation {
  const model = createBoxJoineryModel(params);
  const report = validateBoxJoineryModel(model);
  return {
    ok: report.ok,
    errors: [...report.errors],
    warnings: [...report.warnings],
  };
}

export function generateBoxFacesV2(params: BoxJoineryParams): BoxFace[] {
  const model = createBoxJoineryModel(params);
  const report = validateBoxJoineryModel(model);
  if (!report.ok) {
    throw new Error(`Invalid box joinery model: ${report.errors.join('; ')}`);
  }
  return renderBoxJoineryFaces(model);
}

export function computeBoxJointMetrics(paramsOrThickness: BoxJoineryParams | number, kerf = 0.1, fitAllowance = 0.05): BoxJointMetricsV2 {
  if (typeof paramsOrThickness === 'number') {
    return computeBoxJointMetricsV2(paramsOrThickness, kerf, fitAllowance);
  }
  return computeBoxJointMetricsV2(
    paramsOrThickness.thickness,
    paramsOrThickness.kerf,
    paramsOrThickness.fitAllowance,
    paramsOrThickness.tabExtraDepth,
    paramsOrThickness.slotExtraDepth,
    paramsOrThickness.cornerRelief,
  );
}
