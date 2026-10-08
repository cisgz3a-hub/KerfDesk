import type { CncTool } from './cnc-tool';

/** Saved cutting data uses millimetres, mm/min and RPM independently of display units. */
export type CncCuttingValues = {
  readonly feedMmPerMin: number;
  readonly plungeMmPerMin: number;
  readonly spindleRpm: number;
  readonly depthPerPassMm: number;
  readonly stepoverPercent: number;
};

export type CncCuttingToolContext = Pick<
  CncTool,
  'id' | 'name' | 'kind' | 'diameterMm' | 'tipAngleDeg' | 'tipDiameterMm' | 'family' | 'fluteCount'
>;

export type CncCuttingMachineContext = {
  readonly profileId?: string;
  readonly name: string;
  readonly controllerKind: string;
  readonly spindleMaxRpm: number;
  readonly maxFeedMmPerMin: number;
};

export type CncCuttingContext = {
  readonly tool: CncCuttingToolContext;
  readonly materialKey: string;
  readonly machine: CncCuttingMachineContext;
};

export type CncCuttingProvenance = {
  readonly kind: 'operator' | 'calculator' | 'manufacturer' | 'imported';
  readonly reference: string;
};

export type CncCuttingQualification = {
  readonly status: 'unverified' | 'operator-qualified';
  readonly notes: string;
};

/** Absent context/evidence preserves old library records without claiming qualification. */
export type CncCuttingPreset = CncCuttingValues & {
  readonly id: string;
  readonly name: string;
  readonly units?: 'mm-min-rpm';
  readonly context?: CncCuttingContext;
  readonly provenance?: CncCuttingProvenance;
  readonly qualification?: CncCuttingQualification;
};
