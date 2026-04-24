import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';
import {
  buildPreflightTemplateContext,
  resolveFooterTemplateForValidation,
  validateGcodeTemplates,
} from '../GcodeTemplateValidator';

export function runGcodeTemplateSemanticValidation(
  ctx: PreflightContext,
  out: PreflightResult[],
): void {
  const profile = ctx.profile;
  if (!profile) return;

  const templateContext = buildPreflightTemplateContext(
    ctx.scene,
    ctx.preflightBedWidthMm,
    ctx.preflightBedHeightMm,
  );
  const maxSpindle =
    profile.maxSpindle != null && profile.maxSpindle > 0 ? profile.maxSpindle : 1000;

  const findings = validateGcodeTemplates({
    customStart: profile.startGcode,
    customEnd: profile.endGcode,
    headerTemplate: profile.gcodeHeaderTemplate,
    footerTemplate: resolveFooterTemplateForValidation(profile),
    templateContext,
    bedWidthMm: ctx.preflightBedWidthMm,
    bedHeightMm: ctx.preflightBedHeightMm,
    maxSpindle,
  });

  for (const f of findings) {
    const where =
      f.lineNumber > 0
        ? `[${f.source} — line ${f.lineNumber}]`
        : `[${f.source}]`;
    const message =
      f.line.trim().length > 0 ? `${where}\n${f.line.trim()}\n\n${f.message}` : `${where} ${f.message}`;
    out.push({
      severity: f.severity,
      code: f.code,
      message,
    });
  }
}

export function runTemplateChecks(ctx: PreflightContext, out: PreflightResult[]): void {
  if (!ctx.gcodeHeaderPreview) return;
  if (ctx.profile?.homingEnabled && !/\$H/.test(ctx.gcodeHeaderPreview)) {
    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.HOMING_ENABLED_NO_H,
      message: 'Homing is enabled in profile but $H is missing from header template.',
      fix: { label: 'Enable homing in template', action: { type: 'enableHoming' } },
    });
  }

  const homingHPattern = /(^|\s|;)\$H(\s|$|;)/m;
  const headerWantsHoming = homingHPattern.test(ctx.gcodeHeaderPreview);
  const live = ctx.liveMachineInfo;
  if (
    headerWantsHoming &&
    live != null &&
    typeof live.homingEnabled === 'boolean' &&
    live.homingEnabled === false
  ) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.HOMING_REQUESTED_BUT_DISABLED,
      message:
        "Template '$H' requires machine homing to be enabled. Machine reports $22=0. Enable homing in firmware or choose a template without '$H'.",
    });
  }
}
