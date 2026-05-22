/**
 * Semantic validation for profile header/footer templates and custom start/end
 * G-code (pre-emission; Output.ts paths unchanged).
 */

import {
  BUILT_IN_FOOTER_TEMPLATES,
  BUILT_IN_HEADER_TEMPLATES,
  DEFAULT_FOOTER_TEMPLATE_NAME,
  emptyTemplateContext,
  renderTemplate,
  type GcodeTemplateContext,
} from '../plan/GcodeTemplates';
import { getOutputLayers } from '../scene/Scene';
import type { Scene } from '../scene/Scene';

export type TemplateSource = 'customStart' | 'customEnd' | 'header' | 'footer';

export interface TemplateFinding {
  source: TemplateSource;
  severity: 'error' | 'warning';
  lineNumber: number;
  line: string;
  code: string;
  message: string;
}

export type TemplateValidationDialect = 'grbl' | 'marlin' | 'smoothie' | 'ruida' | 'custom';

export interface TemplateValidationInput {
  customStart?: string;
  customEnd?: string;
  headerTemplate?: string;
  footerTemplate?: string;
  /** T3-42: choose GRBL-specific vs generic/Ruida validation rules. Defaults to GRBL. */
  dialect?: TemplateValidationDialect | string;
  templateContext: GcodeTemplateContext;
  bedWidthMm: number;
  bedHeightMm: number;
  maxSpindle: number;
}

const EPS = 0.01;

interface ParsedGcodeWord {
  readonly letter: string;
  readonly value: number;
}

function stripGcodeComments(line: string): string {
  return line
    .replace(/\([^)]*\)/g, ' ')
    .replace(/;.*$/, ' ')
    .trim();
}

function parseGcodeWords(line: string): ParsedGcodeWord[] {
  const words: ParsedGcodeWord[] = [];
  const re = /([A-Za-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const value = Number.parseFloat(match[2] ?? '');
    if (Number.isFinite(value)) {
      words.push({ letter: (match[1] ?? '').toUpperCase(), value });
    }
  }
  return words;
}

function hasWord(words: readonly ParsedGcodeWord[], letter: string, value: number): boolean {
  const expectedLetter = letter.toUpperCase();
  return words.some(word => word.letter === expectedLetter && word.value === value);
}

function lastWordValue(words: readonly ParsedGcodeWord[], letter: string): number | undefined {
  const expectedLetter = letter.toUpperCase();
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (word?.letter === expectedLetter) return word.value;
  }
  return undefined;
}

/** Same footer substitution as compile when return-to-origin is off. */
export function resolveFooterTemplateForValidation(profile: {
  gcodeFooterTemplate?: string;
  returnToOrigin?: boolean;
}): string | undefined {
  const raw = profile.gcodeFooterTemplate;
  if (!(profile.returnToOrigin ?? true)) {
    if (raw === BUILT_IN_FOOTER_TEMPLATES[DEFAULT_FOOTER_TEMPLATE_NAME]) {
      return BUILT_IN_FOOTER_TEMPLATES['Stay in place'];
    }
  }
  return raw;
}

export function buildPreflightTemplateContext(
  scene: Scene,
  bedWidthMm: number,
  bedHeightMm: number,
): GcodeTemplateContext {
  const outputLayers = getOutputLayers(scene);
  const maxSpeed = Math.max(0, ...outputLayers.map(l => l.settings.speed));
  return {
    ...emptyTemplateContext(),
    jobName: scene.metadata?.name?.trim() || 'untitled',
    bedWidthMm,
    bedHeightMm,
    maxSpeedMmPerMin: maxSpeed,
    totalLines: 0,
    estimatedTime: 'unknown',
    materialName: scene.material?.name ?? '',
    materialThicknessMm: scene.material?.thickness ?? 0,
    returnX: 0,
    returnY: 0,
  };
}

export function validateGcodeTemplates(input: TemplateValidationInput): TemplateFinding[] {
  return getTemplateValidatorForDialect(input.dialect)(input);
}

type TemplateValidator = (input: TemplateValidationInput) => TemplateFinding[];

interface TemplateProfileDialect {
  outputDialect?: string;
  outputFormat?: string;
}

export function templateValidationDialectFromProfile(
  profile: TemplateProfileDialect | null | undefined,
): TemplateValidationDialect {
  return normalizeTemplateDialect(profile?.outputDialect ?? profile?.outputFormat);
}

export function getTemplateValidatorForDialect(dialect: string | null | undefined): TemplateValidator {
  const normalized = normalizeTemplateDialect(dialect);
  switch (normalized) {
    case 'ruida':
      return validateRuidaTemplates;
    case 'marlin':
    case 'smoothie':
    case 'custom':
      return validateGenericGcodeTemplates;
    case 'grbl':
    default:
      return validateGrblTemplates;
  }
}

function normalizeTemplateDialect(dialect: string | null | undefined): TemplateValidationDialect {
  const raw = (dialect ?? 'grbl').trim().toLowerCase();
  if (raw.includes('ruida')) return 'ruida';
  if (raw.includes('marlin')) return 'marlin';
  if (raw.includes('smoothie')) return 'smoothie';
  if (raw.includes('custom')) return 'custom';
  return 'grbl';
}

function validateGrblTemplates(input: TemplateValidationInput): TemplateFinding[] {
  return validateTemplatesWithResolvedText(input, validateGrblResolvedText, true);
}

function validateGenericGcodeTemplates(input: TemplateValidationInput): TemplateFinding[] {
  return validateTemplatesWithResolvedText(input, validateGenericGcodeResolvedText, true);
}

function validateRuidaTemplates(_input: TemplateValidationInput): TemplateFinding[] {
  // T3-42: Ruida output is binary/device-native; LaserForge does not expose
  // user-editable G-code templates for that dialect, so GRBL rules like $X,
  // $H, and M5 footer hygiene are meaningless here.
  return [];
}

function validateTemplatesWithResolvedText(
  input: TemplateValidationInput,
  validateResolved: (
    text: string,
    source: TemplateSource,
    input: TemplateValidationInput,
  ) => TemplateFinding[],
  checkFooterLaserOff: boolean,
): TemplateFinding[] {
  const findings: TemplateFinding[] = [];

  const sources: Array<{ name: TemplateSource; text: string | undefined; isTemplate: boolean }> = [
    { name: 'customStart', text: input.customStart, isTemplate: false },
    { name: 'customEnd', text: input.customEnd, isTemplate: false },
    { name: 'header', text: input.headerTemplate, isTemplate: true },
    { name: 'footer', text: input.footerTemplate, isTemplate: true },
  ];

  for (const src of sources) {
    if (!src.text || src.text.trim().length === 0) continue;

    if (src.isTemplate) {
      const trustedSet =
        src.name === 'header'
          ? Object.values(BUILT_IN_HEADER_TEMPLATES)
          : Object.values(BUILT_IN_FOOTER_TEMPLATES);
      if (trustedSet.includes(src.text)) continue;
    }

    const resolved = src.isTemplate
      ? renderTemplate(src.text, input.templateContext)
      : src.text;

    findings.push(...validateResolved(resolved, src.name, input));
  }

  if (checkFooterLaserOff && shouldCheckFooterLaserOff(input)) {
    const footerRendered = input.footerTemplate?.trim()
      ? renderTemplate(input.footerTemplate!, input.templateContext)
      : '';
    const combinedTail = `${input.customEnd ?? ''}\n${footerRendered}`;
    if (!/\bM5\b/i.test(combinedTail)) {
      findings.push({
        source: 'footer',
        severity: 'error',
        lineNumber: 0,
        line: '',
        code: 'FOOTER_MISSING_M5',
        message:
          'Custom footer/end G-code does not contain M5. The laser must be turned off at job end.',
      });
    }
  }

  return findings;
}

function shouldCheckFooterLaserOff(input: TemplateValidationInput): boolean {
  return Boolean(input.customEnd?.trim() || input.footerTemplate?.trim());
}

function isSafeQueryDollar(line: string): boolean {
  return (
    /^\$\$/.test(line) ||
    /^\$#/.test(line) ||
    /^\$G\b/i.test(line) ||
    /^\$I\b/i.test(line) ||
    /^\$N\b/i.test(line) ||
    /^\$H(\s|;|$)/i.test(line) ||
    line === '$H' ||
    /^\$J=/i.test(line) ||
    /^\$\d+\?/.test(line)
  );
}

function validateGrblResolvedText(
  text: string,
  source: TemplateSource,
  input: TemplateValidationInput,
): TemplateFinding[] {
  return validateResolvedText(text, source, input, true);
}

function validateGenericGcodeResolvedText(
  text: string,
  source: TemplateSource,
  input: TemplateValidationInput,
): TemplateFinding[] {
  return validateResolvedText(text, source, input, false);
}

function validateResolvedText(
  text: string,
  source: TemplateSource,
  input: TemplateValidationInput,
  grblSpecific: boolean,
): TemplateFinding[] {
  const findings: TemplateFinding[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = stripGcodeComments(raw);
    if (line.length === 0) continue;
    const words = parseGcodeWords(line);

    const push = (severity: 'error' | 'warning', code: string, message: string): void => {
      findings.push({
        source,
        severity,
        lineNumber: i + 1,
        line: raw,
        code,
        message,
      });
    };

    if (grblSpecific && line === '$X') {
      push('error', 'TEMPLATE_UNLOCK', '$X unlocks the alarm state and must not appear in templates or custom G-code.');
      continue;
    }
    if (grblSpecific && /^\$RST=[*#$]$/i.test(line)) {
      push(
        'error',
        'TEMPLATE_EEPROM_RESET',
        '$RST=* / $RST=# / $RST=$ erases firmware settings and must not appear in templates or custom G-code.',
      );
      continue;
    }
    if (grblSpecific && line === '$SLP') {
      push('error', 'TEMPLATE_SLEEP', '$SLP puts the controller to sleep and must not appear in templates or custom G-code.');
      continue;
    }
    if (grblSpecific && /^\$\d+=/.test(line)) {
      const key = line.split('=')[0] ?? line;
      push(
        'error',
        'TEMPLATE_DOLLAR_WRITE',
        `Templates must not write GRBL settings (${key}=).`,
      );
      continue;
    }

    const laserOnWord = words.find(word => word.letter === 'M' && (word.value === 3 || word.value === 4));
    if (laserOnWord) {
      const sVal = lastWordValue(words, 'S');
      if (sVal === undefined || sVal > 0) {
        push(
          'error',
          'TEMPLATE_LASER_ON_NO_MOTION',
          'Templates must not turn the laser on at non-zero power without a motion context. Use M5 or M3/M4 with S0 only.',
        );
        continue;
      }
    }

    // T1-43: G91 / G90 in header or customStart conflict with LaserForge mode
    // management. G91 keeps code TEMPLATE_G91_IN_HEADER (existing test pin);
    // messages name the actual source when customStart.
    if (hasWord(words, 'G', 91) && (source === 'header' || source === 'customStart')) {
      const where = source === 'customStart' ? 'a custom start g-code block' : 'a header';
      push(
        'error',
        'TEMPLATE_G91_IN_HEADER',
        `G91 (relative mode) in ${where} conflicts with LaserForge mode management. Remove G91; LaserForge sets positioning mode from the job's start-mode setting.`,
      );
      continue;
    }
    if (hasWord(words, 'G', 90) && (source === 'header' || source === 'customStart')) {
      const where = source === 'customStart' ? 'a custom start g-code block' : 'a header';
      push(
        'error',
        'TEMPLATE_G90_IN_HEADER',
        `G90 (absolute mode) in ${where} conflicts with LaserForge mode management. Remove G90; LaserForge sets positioning mode from the job's start-mode setting.`,
      );
      continue;
    }
    if (hasWord(words, 'G', 92)) {
      push(
        'error',
        'TEMPLATE_G92',
        'G92 changes the coordinate system mid-stream. Use Set Origin instead of embedding G92 in templates.',
      );
      continue;
    }
    if (hasWord(words, 'G', 10)) {
      push(
        'error',
        'TEMPLATE_G10',
        'G10 changes work coordinate offsets. Templates must not modify WCS — use Set Origin or the connection-time consent flow.',
      );
      continue;
    }

    const motion = words.find(word => word.letter === 'G' && word.value >= 0 && word.value <= 3);
    if (motion && (input.bedWidthMm > 0 || input.bedHeightMm > 0)) {
      const x = lastWordValue(words, 'X');
      const y = lastWordValue(words, 'Y');
      if (input.bedWidthMm > 0 && x !== undefined) {
        if (Number.isFinite(x) && (x < -EPS || x > input.bedWidthMm + EPS)) {
          push(
            'error',
            'TEMPLATE_MOTION_OUT_OF_BED',
            `Motion command X=${x.toFixed(3)} is outside bed width ${input.bedWidthMm.toFixed(0)} mm.`,
          );
          continue;
        }
      }
      if (input.bedHeightMm > 0 && y !== undefined) {
        if (Number.isFinite(y) && (y < -EPS || y > input.bedHeightMm + EPS)) {
          push(
            'error',
            'TEMPLATE_MOTION_OUT_OF_BED',
            `Motion command Y=${y.toFixed(3)} is outside bed height ${input.bedHeightMm.toFixed(0)} mm.`,
          );
          continue;
        }
      }
    }

    const sGlobal = /(?:^|\s|\b)S\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/i.exec(line);
    if (sGlobal && input.maxSpindle > 0) {
      const s = parseFloat(sGlobal[1] ?? 'NaN');
      if (Number.isFinite(s) && s > input.maxSpindle + EPS) {
        push(
          'error',
          'TEMPLATE_S_EXCEEDS_MAX_SPINDLE',
          `S=${s} exceeds profile maxSpindle ${input.maxSpindle}.`,
        );
        continue;
      }
    }

    const fMatch = /(?:^|\s|\b)F\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/i.exec(line);
    if (fMatch) {
      const f = parseFloat(fMatch[1] ?? 'NaN');
      if (Number.isFinite(f) && (f < 1 || f > 100_000)) {
        push(
          'error',
          'TEMPLATE_F_OUT_OF_RANGE',
          `F=${f} is outside the sensible range [1, 100000] mm/min.`,
        );
        continue;
      }
    }

    if ((source === 'customStart' || source === 'customEnd') && /^G([0-3])(?![0-9])/i.test(line)) {
      const preview = line.length > 40 ? `${line.slice(0, 40)}…` : line;
      push(
        'warning',
        'TEMPLATE_CUSTOM_HAS_MOTION',
        `Custom ${source === 'customStart' ? 'start' : 'end'} G-code contains a motion command (${preview}). This moves the head outside the validated plan.`,
      );
    }

    if (grblSpecific && /^\$/.test(line) && !isSafeQueryDollar(line)) {
      push(
        'warning',
        'TEMPLATE_UNKNOWN_DOLLAR',
        `Unknown or non-query $ command (${line}). It may not be supported by your firmware.`,
      );
    }
  }

  return findings;
}
