// Effective laser lead-in / lead-out settings (ADR-626, LBG-C14). Each is
// optional on the operation; absent means no lead, the behaviour KerfDesk had
// before leads existed, so an untouched operation compiles unchanged.
//
// One length, style, angle and side serve both leads of an operation. The
// length is the lead's own path length, so it is also the extra burn per lead.
// The angle means what the style needs: for an arc, how far it turns before it
// meets the cut (90 degrees is a quarter circle); for a line, the angle it
// meets the cut at (90 degrees comes straight in from the side).

import { operationOverrideForObject } from '../effective-output';
import type { Layer, LayerOperationSettings, Scene, SceneObject } from '../scene';
// Deep import: core/scene's barrel is ratcheted and may only shrink.
import { isLaserLeadSettingKey, type LaserLeadSide, type LaserLeadStyle } from '../scene/layer';

export const DEFAULT_LEAD_LENGTH_MM = 2;
export const MIN_LEAD_LENGTH_MM = 0.1;
export const MAX_LEAD_LENGTH_MM = 20;
export const DEFAULT_ARC_LEAD_ANGLE_DEG = 90;
export const DEFAULT_LINE_LEAD_ANGLE_DEG = 45;
export const MIN_LEAD_ANGLE_DEG = 10;
export const MAX_ARC_LEAD_ANGLE_DEG = 180;
export const MAX_LINE_LEAD_ANGLE_DEG = 90;
/** A lead keeps at least this far from every cut line it does not join, or
 * one kerf width (twice the kerf offset) when that is wider, up to the most. */
export const MIN_LEAD_CLEARANCE_MM = 0.2;
export const MAX_LEAD_CLEARANCE_MM = 1;

type LeadSettings = Pick<
  LayerOperationSettings,
  | 'leadInEnabled'
  | 'leadOutEnabled'
  | 'leadStyle'
  | 'leadLengthMm'
  | 'leadAngleDeg'
  | 'leadSide'
  | 'kerfOffsetMm'
>;

/** What a Line cut group's closed contours get once the planner has chosen
 * where each one starts (apply-laser-leads.ts). */
export type LaserLeadSpec = {
  readonly leadIn: boolean;
  readonly leadOut: boolean;
  readonly style: LaserLeadStyle;
  readonly lengthMm: number;
  readonly angleDeg: number;
  readonly side: LaserLeadSide;
  readonly clearanceMm: number;
};

/** A cut group's leads, with the operation name Job Review reports them under. */
export type CutGroupLaserLeads = LaserLeadSpec & { readonly operationName: string };

type LeadSwitches = Pick<LayerOperationSettings, 'leadInEnabled' | 'leadOutEnabled'>;

function asksForLeads(settings: Partial<LeadSwitches> | null | undefined): boolean {
  return settings?.leadInEnabled === true || settings?.leadOutEnabled === true;
}

/** Whether any operation, sub-operation or artwork override in the scene asks
 * for a lead; compile keeps what leads need (CutGroup.topologyRings) only then. */
export function sceneAsksForLaserLeads(scene: Pick<Scene, 'layers' | 'objects'>): boolean {
  return (
    scene.layers.some(
      (layer) => asksForLeads(layer) || layer.subLayers.some((sub) => asksForLeads(sub.settings)),
    ) ||
    scene.objects.some((object) => {
      const override = object.operationOverride;
      return (
        asksForLeads(override) ||
        Object.values(override?.byOperation ?? {}).some((entry) => asksForLeads(entry))
      );
    })
  );
}

/** The operation's leads, or null when it asks for neither. */
export function laserLeadSpecFor(settings: LeadSettings): LaserLeadSpec | null {
  const leadIn = settings.leadInEnabled === true;
  const leadOut = settings.leadOutEnabled === true;
  if (!leadIn && !leadOut) return null;
  const style = leadStyleFor(settings);
  return {
    leadIn,
    leadOut,
    style,
    lengthMm: leadLengthMmFor(settings),
    angleDeg: leadAngleDegFor(settings, style),
    side: leadSideFor(settings),
    clearanceMm: clamp(
      2 * Math.abs(finiteOr(settings.kerfOffsetMm, 0)),
      MIN_LEAD_CLEARANCE_MM,
      MAX_LEAD_CLEARANCE_MM,
    ),
  };
}

export function leadStyleFor(settings: Pick<LeadSettings, 'leadStyle'>): LaserLeadStyle {
  return settings.leadStyle === 'line' ? 'line' : 'arc';
}

export function leadSideFor(settings: Pick<LeadSettings, 'leadSide'>): LaserLeadSide {
  return settings.leadSide === 'outside' || settings.leadSide === 'inside'
    ? settings.leadSide
    : 'auto';
}

export function leadLengthMmFor(settings: Pick<LeadSettings, 'leadLengthMm'>): number {
  const value = settings.leadLengthMm;
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LEAD_LENGTH_MM;
  return clamp(value, MIN_LEAD_LENGTH_MM, MAX_LEAD_LENGTH_MM);
}

export function leadAngleDegFor(
  settings: Pick<LeadSettings, 'leadAngleDeg'>,
  style: LaserLeadStyle,
): number {
  const fallback = style === 'arc' ? DEFAULT_ARC_LEAD_ANGLE_DEG : DEFAULT_LINE_LEAD_ANGLE_DEG;
  const value = settings.leadAngleDeg;
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return clamp(value, MIN_LEAD_ANGLE_DEG, maxLeadAngleDeg(style));
}

export function maxLeadAngleDeg(style: LaserLeadStyle): number {
  return style === 'arc' ? MAX_ARC_LEAD_ANGLE_DEG : MAX_LINE_LEAD_ANGLE_DEG;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

/** Whether an artwork's override changes what `effective` cuts, as output reads
 * it. Lead shape and side stored with both leads off change nothing, as leads
 * off promise, so an override of only those is none. An override that sets a
 * lead switch counts: it may turn off leads its operation has on. */
export function hasOutputOperationOverride(
  effective: Layer,
  object: Pick<SceneObject, 'operationOverride'>,
): boolean {
  const override = operationOverrideForObject(effective, object);
  if (override === undefined) return false;
  return (
    laserLeadSpecFor(effective) !== null ||
    Object.keys(override).some((key) => !isLaserLeadSettingKey(key) || LEAD_SWITCHES.has(key))
  );
}

const LEAD_SWITCHES: ReadonlySet<string> = new Set(['leadInEnabled', 'leadOutEnabled']);
