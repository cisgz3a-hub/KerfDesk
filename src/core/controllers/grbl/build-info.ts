export type StockGrblOption =
  | 'V'
  | 'N'
  | 'M'
  | 'C'
  | 'P'
  | 'Z'
  | 'H'
  | 'T'
  | 'A'
  | 'D'
  | '0'
  | 'S'
  | 'R'
  | 'L'
  | '+'
  | '*'
  | '$'
  | '#'
  | 'I'
  | 'E'
  | 'W'
  | '2';

export type GrblBuildInfo = {
  readonly protocolVersion: string;
  readonly buildRevision: string;
  readonly userInfo: string;
  readonly optionCodes: ReadonlyArray<StockGrblOption>;
  readonly plannerBufferBlocks: number;
  readonly rxBufferBytes: number;
};

export type BuildInfoResult =
  | { readonly ok: true; readonly value: GrblBuildInfo }
  | { readonly ok: false; readonly reason: string };

const STOCK_OPTION_ORDER = 'VNMCPZHTAD0SRL+*$#IEW2';
const UNSUPPORTED_PROBE_OPTIONS = new Set<StockGrblOption>(['A', 'C', 'E', 'W', 'L', '2']);
const AUDITED_PROTOCOL = '1.1h';
const AUDITED_BUILD = '20190830';

export function parseBuildInfoResponses(lines: readonly string[]): BuildInfoResult {
  // `lines` are the semantic responses returned by one owned `$I` command.
  // The command arbiter consumes the terminal `ok`; asynchronous status/push
  // reports are routed elsewhere. Reset, alarm, error, or extra semantic
  // responses must make the owner reject before calling here.
  if (lines.length !== 2) {
    return { ok: false, reason: 'Build-info response must contain exactly VER and OPT.' };
  }
  const version = parseVersion(lines[0] ?? '');
  if (version === null) return { ok: false, reason: 'Malformed or missing GRBL VER response.' };
  const options = parseOptions(lines[1] ?? '');
  if (options === null) return { ok: false, reason: 'Malformed or unsupported GRBL OPT response.' };
  return { ok: true, value: { ...version, ...options } };
}

export function validateProbeBuildCompatibility(
  build: GrblBuildInfo,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (build.protocolVersion !== AUDITED_PROTOCOL || build.buildRevision !== AUDITED_BUILD) {
    return {
      ok: false,
      reason: 'Automatic probing requires a GRBL build reporting the qualified 1.1h revision.',
    };
  }
  if (build.optionCodes.includes('P') && build.optionCodes.includes('Z')) {
    return {
      ok: false,
      reason: 'GRBL parking with forced homing origin is not probe-qualified.',
    };
  }
  for (const option of build.optionCodes) {
    if (UNSUPPORTED_PROBE_OPTIONS.has(option)) {
      return { ok: false, reason: `GRBL build option ${option} is not probe-qualified.` };
    }
  }
  return { ok: true };
}

function parseVersion(
  line: string,
): Pick<GrblBuildInfo, 'protocolVersion' | 'buildRevision' | 'userInfo'> | null {
  const match = /^\[VER:(1\.1[a-z])\.(\d{8}):(.*)\]$/.exec(line);
  if (match === null) return null;
  return {
    protocolVersion: match[1] ?? '',
    buildRevision: match[2] ?? '',
    userInfo: match[3] ?? '',
  };
}

function parseOptions(
  line: string,
): Pick<GrblBuildInfo, 'optionCodes' | 'plannerBufferBlocks' | 'rxBufferBytes'> | null {
  const match = /^\[OPT:([^,]*),(\d+),(\d+)\]$/.exec(line);
  if (match === null) return null;
  const rawCodes = match[1] ?? '';
  const codes = [...rawCodes] as Array<StockGrblOption>;
  if (!isCanonicalOptionSubsequence(codes)) return null;
  const plannerBufferBlocks = Number(match[2]);
  const rxBufferBytes = Number(match[3]);
  if (!isPositiveInteger(plannerBufferBlocks) || !isPositiveInteger(rxBufferBytes)) return null;
  return { optionCodes: codes, plannerBufferBlocks, rxBufferBytes };
}

function isCanonicalOptionSubsequence(codes: ReadonlyArray<string>): codes is StockGrblOption[] {
  let previousIndex = -1;
  for (const code of codes) {
    const index = STOCK_OPTION_ORDER.indexOf(code);
    if (index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}
