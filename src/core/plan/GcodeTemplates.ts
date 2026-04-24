/**
 * @file GcodeTemplates.ts
 * @copyright (c) 2025 LaserForge. All rights reserved.
 *
 * Templates for customizable G-code header/footer sections.
 * Users can include variables like {JOB_NAME}, {DATE}, {BED_WIDTH} in
 * their templates, which are substituted at compile time.
 */

export interface GcodeTemplateContext {
  /** Job/scene name. Fallback "untitled". */
  jobName: string;
  /** ISO date string, e.g. "2026-04-16". */
  date: string;
  /** ISO time string, e.g. "14:30:22". */
  time: string;
  /** Machine bed width in mm. */
  bedWidthMm: number;
  /** Machine bed height in mm. */
  bedHeightMm: number;
  /** Max scan speed used in job (mm/min). */
  maxSpeedMmPerMin: number;
  /** Total G-code line count (resolved by caller after body is generated). */
  totalLines: number;
  /** Estimated duration, formatted as "mm:ss" or "h:mm:ss". Empty if unknown. */
  estimatedTime: string;
  /** Primary material name used in job. Empty if none assigned. */
  materialName: string;
  /** Primary material thickness in mm. 0 if unknown. */
  materialThicknessMm: number;
  /** Machine-space X for end-of-job return rapid (WCS / emitted coords). */
  returnX: number;
  /** Machine-space Y for end-of-job return rapid (WCS / emitted coords). */
  returnY: number;
}

/**
 * Create a default context from scratch. Caller fills in known values.
 */
export function emptyTemplateContext(): GcodeTemplateContext {
  const now = new Date();
  return {
    jobName: 'untitled',
    date: now.toISOString().slice(0, 10),
    time: now.toISOString().slice(11, 19),
    bedWidthMm: 0,
    bedHeightMm: 0,
    maxSpeedMmPerMin: 0,
    totalLines: 0,
    estimatedTime: '',
    materialName: '',
    materialThicknessMm: 0,
    returnX: 0,
    returnY: 0,
  };
}

/**
 * Substitute {VAR} placeholders in a template string with values from context.
 * Unknown variables are left as-is (user will see the literal {FOO} in output,
 * which is the clearest signal that they typoed).
 */
export function renderTemplate(template: string, context: GcodeTemplateContext): string {
  if (!template) return '';
  return template.replace(/\{([A-Z0-9_]+)\}/g, (match, key) => {
    switch (key) {
      case 'JOB_NAME': return context.jobName;
      case 'DATE': return context.date;
      case 'TIME': return context.time;
      case 'BED_WIDTH': return context.bedWidthMm.toFixed(0);
      case 'BED_HEIGHT': return context.bedHeightMm.toFixed(0);
      case 'MAX_SPEED': return context.maxSpeedMmPerMin.toFixed(0);
      case 'TOTAL_LINES': return context.totalLines.toString();
      case 'ESTIMATED_TIME': return context.estimatedTime || 'unknown';
      case 'MATERIAL_NAME': return context.materialName || 'none';
      case 'MATERIAL_THICKNESS': return context.materialThicknessMm.toFixed(2);
      case 'RETURN_X': return context.returnX.toFixed(3);
      case 'RETURN_Y': return context.returnY.toFixed(3);
      case 'BED_WIDTH_MINUS_5':
        return Math.max(0, context.bedWidthMm - 5).toFixed(3);
      case 'BED_HEIGHT_MINUS_5':
        return Math.max(0, context.bedHeightMm - 5).toFixed(3);
      default: return match;
    }
  });
}

/**
 * Commonly used built-in templates, keyed by name.
 * Users can start from one of these and customize.
 */
export const BUILT_IN_HEADER_TEMPLATES: Record<string, string> = {
  'GRBL (generic)': [
    '; LaserForge job: {JOB_NAME}',
    '; Generated: {DATE} {TIME}',
    '; Machine: {BED_WIDTH} x {BED_HEIGHT} mm',
    '; Material: {MATERIAL_NAME} ({MATERIAL_THICKNESS}mm)',
    'G90 ; absolute positioning',
    'G21 ; mm units',
    'M4 S0 ; laser dynamic mode, off',
  ].join('\n'),

  'GRBL with homing': [
    '; LaserForge job: {JOB_NAME}',
    '; Generated: {DATE} {TIME}',
    '$H ; home machine before run',
    'G90 ; absolute positioning',
    'G21 ; mm units',
    'M4 S0 ; laser dynamic mode, off',
  ].join('\n'),

  'Constant-power (M3)': [
    '; LaserForge job: {JOB_NAME}',
    '; Generated: {DATE} {TIME}',
    'G90 ; absolute positioning',
    'G21 ; mm units',
    'M3 S0 ; laser constant mode, off',
  ].join('\n'),

  'With air assist': [
    '; LaserForge job: {JOB_NAME}',
    '; Generated: {DATE} {TIME}',
    'G90 ; absolute positioning',
    'G21 ; mm units',
    'M8 ; air assist on (change to M106 Sxxx for PWM)',
    'M4 S0 ; laser dynamic mode, off',
  ].join('\n'),
};

export const BUILT_IN_FOOTER_TEMPLATES: Record<string, string> = {
  'Park at origin': [
    'M5 ; laser off',
    'G0 X{RETURN_X} Y{RETURN_Y} ; return to origin',
    '; Total lines: {TOTAL_LINES}',
    '; Estimated time: {ESTIMATED_TIME}',
  ].join('\n'),

  'Park near far corner': [
    'M5 ; laser off',
    'G0 X{BED_WIDTH_MINUS_5} Y{BED_HEIGHT_MINUS_5} ; park 5mm from far corner',
    '; Total lines: {TOTAL_LINES}',
  ].join('\n'),

  'Stay in place': [
    'M5 ; laser off',
    '; head stays at last position',
    '; Total lines: {TOTAL_LINES}',
  ].join('\n'),

  'With completion marker': [
    'M5 ; laser off',
    'G0 X{RETURN_X} Y{RETURN_Y} ; return to origin',
    '; ===== JOB COMPLETE =====',
    '; Total lines: {TOTAL_LINES}',
  ].join('\n'),

  'With air assist off': [
    'M5 ; laser off',
    'M9 ; air assist off',
    'G0 X{RETURN_X} Y{RETURN_Y} ; return to origin',
  ].join('\n'),
};

/**
 * Default header template name for new device profiles.
 */
export const DEFAULT_HEADER_TEMPLATE_NAME = 'GRBL (generic)';
export const DEFAULT_FOOTER_TEMPLATE_NAME = 'Park at origin';

/**
 * Pre–T0-2 built-in footer bodies, for migrating stored profiles.
 * (Profiles store the full template string, not the preset name.)
 */
export const LEGACY_FOOTER_BODY__PARK_AT_MAX_BED = [
  'M5 ; laser off',
  'G0 X{BED_WIDTH} Y{BED_HEIGHT} ; park at far corner',
  '; Total lines: {TOTAL_LINES}',
].join('\n');

export const LEGACY_FOOTER_BODY__WITH_BEEP = [
  'M5 ; laser off',
  'G0 X{RETURN_X} Y{RETURN_Y} ; return to origin',
  'M300 P500 S1000 ; 500ms beep at 1kHz (Marlin)',
  '; Total lines: {TOTAL_LINES}',
].join('\n');
