import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import type { StrokeFont } from './stroke-font-text';

type SvgStrokeGlyphData = {
  readonly advance: number;
  readonly path?: string;
};

export type SvgStrokeFontData = {
  readonly capHeight: number;
  readonly glyphs: Readonly<Record<string, SvgStrokeGlyphData>>;
};

type SvgCommand = 'M' | 'm' | 'L' | 'l' | 'H' | 'h' | 'V' | 'v' | 'C' | 'c' | 'S' | 's' | 'Z' | 'z';

const COMMANDS = new Set<SvgCommand>([
  'M',
  'm',
  'L',
  'l',
  'H',
  'h',
  'V',
  'v',
  'C',
  'c',
  'S',
  's',
  'Z',
  'z',
]);
const NUMBER_AT_START = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;

/** Compiles centerline SVG glyph data into open machining paths. */
export function svgStrokeFont(data: SvgStrokeFontData): StrokeFont {
  return {
    capHeight: data.capHeight,
    yAxis: 'up',
    glyphs: new Map(
      Object.entries(data.glyphs).map(([character, glyph]) => [
        character,
        {
          advance: glyph.advance,
          paths: parseSvgStrokePath(glyph.path ?? ''),
        },
      ]),
    ),
  };
}

/**
 * Parses the line and cubic commands used by the pinned Relief and EMS sources.
 * Closed source contours are deliberately emitted as open toolpaths.
 */
export function parseSvgStrokePath(pathData: string): ReadonlyArray<CurveSubpath> {
  return new SvgStrokePathParser(tokenize(pathData)).parse();
}

type PathToken = SvgCommand | number;

class SvgStrokePathParser {
  private readonly paths: CurveSubpath[] = [];
  private activeCommand: SvgCommand | null = null;
  private current: Vec2 = { x: 0, y: 0 };
  private hasCurrent = false;
  private subpathStart: Vec2 | null = null;
  private segments: PathSegment[] = [];
  private previousCommand: SvgCommand | null = null;
  private previousCubicControl: Vec2 | null = null;
  private index = 0;

  public constructor(private readonly tokens: ReadonlyArray<PathToken>) {}

  public parse(): ReadonlyArray<CurveSubpath> {
    while (this.index < this.tokens.length) {
      const selectedClose = this.selectCommand();
      if (selectedClose) continue;
      this.drawActiveCommand();
    }
    this.emit();
    return this.paths;
  }

  private selectCommand(): boolean {
    const token = this.tokens[this.index];
    if (!isCommand(token)) return false;
    this.activeCommand = token;
    this.index += 1;
    if (token !== 'Z' && token !== 'z') return false;
    this.closePath(token);
    return true;
  }

  private drawActiveCommand(): void {
    const command = this.activeCommand;
    if (command === null) throw new Error('SVG stroke path must start with a command.');
    const kind = command.toUpperCase();
    if (kind === 'M') return this.move(command);
    if (kind === 'L') return this.line(command);
    if (kind === 'H') return this.horizontal(command);
    if (kind === 'V') return this.vertical(command);
    if (kind === 'C') return this.cubic(command);
    if (kind === 'S') return this.smoothCubic(command);
    throw new Error(`SVG stroke path cannot draw command "${command}".`);
  }

  private move(command: SvgCommand): void {
    const [x = 0, y = 0] = this.readNumbers(2);
    const relative = isRelative(command);
    this.emit();
    this.current = this.targetPoint(x, y, relative && this.hasCurrent);
    this.hasCurrent = true;
    this.subpathStart = { ...this.current };
    this.resetCurveState(command);
    this.activeCommand = relative ? 'l' : 'L';
  }

  private line(command: SvgCommand): void {
    this.requireCurrent();
    const [x = 0, y = 0] = this.readNumbers(2);
    this.addLine(this.targetPoint(x, y, isRelative(command)), command);
  }

  private horizontal(command: SvgCommand): void {
    this.requireCurrent();
    const [x = 0] = this.readNumbers(1);
    const targetX = isRelative(command) ? this.current.x + x : x;
    this.addLine({ x: targetX, y: this.current.y }, command);
  }

  private vertical(command: SvgCommand): void {
    this.requireCurrent();
    const [y = 0] = this.readNumbers(1);
    const targetY = isRelative(command) ? this.current.y + y : y;
    this.addLine({ x: this.current.x, y: targetY }, command);
  }

  private cubic(command: SvgCommand): void {
    this.requireCurrent();
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, x = 0, y = 0] = this.readNumbers(6);
    const relative = isRelative(command);
    this.addCubic(
      this.targetPoint(x1, y1, relative),
      this.targetPoint(x2, y2, relative),
      this.targetPoint(x, y, relative),
      command,
    );
  }

  private smoothCubic(command: SvgCommand): void {
    this.requireCurrent();
    const [x2 = 0, y2 = 0, x = 0, y = 0] = this.readNumbers(4);
    const relative = isRelative(command);
    this.addCubic(
      this.smoothControl1(),
      this.targetPoint(x2, y2, relative),
      this.targetPoint(x, y, relative),
      command,
    );
  }

  private addLine(to: Vec2, command: SvgCommand): void {
    this.segments.push({ kind: 'line', to });
    this.current = to;
    this.resetCurveState(command);
  }

  private addCubic(control1: Vec2, control2: Vec2, to: Vec2, command: SvgCommand): void {
    this.segments.push({ kind: 'cubic', control1, control2, to });
    this.current = to;
    this.previousCommand = command;
    this.previousCubicControl = control2;
  }

  private smoothControl1(): Vec2 {
    const canReflect =
      this.previousCubicControl !== null &&
      this.previousCommand !== null &&
      'CcSs'.includes(this.previousCommand);
    return canReflect && this.previousCubicControl !== null
      ? reflect(this.previousCubicControl, this.current)
      : { ...this.current };
  }

  private closePath(command: SvgCommand): void {
    if (this.subpathStart === null) {
      throw new Error('SVG stroke close command appears before a move.');
    }
    if (!samePoint(this.current, this.subpathStart)) {
      this.segments.push({ kind: 'line', to: { ...this.subpathStart } });
    }
    const closedStart: Vec2 = { x: this.subpathStart.x, y: this.subpathStart.y };
    this.emit();
    this.current = closedStart;
    this.hasCurrent = true;
    this.subpathStart = closedStart;
    this.resetCurveState(command);
    this.activeCommand = null;
  }

  private readNumbers(count: number): ReadonlyArray<number> {
    const values: number[] = [];
    for (let offset = 0; offset < count; offset += 1) {
      const token = this.tokens[this.index + offset];
      if (token === undefined || isCommand(token)) {
        throw new Error(
          `SVG stroke path has an incomplete ${this.activeCommand ?? 'unknown'} command.`,
        );
      }
      values.push(token);
    }
    this.index += count;
    return values;
  }

  private requireCurrent(): void {
    if (!this.hasCurrent) throw new Error('SVG stroke segment appears before a move.');
    if (this.subpathStart === null) this.subpathStart = { ...this.current };
  }

  private targetPoint(x: number, y: number, relative: boolean): Vec2 {
    return {
      x: x + (relative ? this.current.x : 0),
      y: y + (relative ? this.current.y : 0),
    };
  }

  private resetCurveState(command: SvgCommand): void {
    this.previousCommand = command;
    this.previousCubicControl = null;
  }

  private emit(): void {
    if (this.subpathStart !== null && this.segments.length > 0) {
      this.paths.push({ start: this.subpathStart, segments: this.segments, closed: false });
    }
    this.subpathStart = null;
    this.segments = [];
  }
}

function tokenize(pathData: string): ReadonlyArray<SvgCommand | number> {
  const tokens: Array<SvgCommand | number> = [];
  let index = 0;
  while (index < pathData.length) {
    const separators = /^[\s,]+/.exec(pathData.slice(index));
    if (separators !== null) index += separators[0].length;
    if (index >= pathData.length) break;
    const next = pathData[index];
    if (next !== undefined && /[A-Za-z]/.test(next)) {
      if (!isCommand(next)) {
        throw new Error(`SVG stroke path uses unsupported command "${next}".`);
      }
      tokens.push(next);
      index += 1;
      continue;
    }
    const number = NUMBER_AT_START.exec(pathData.slice(index));
    if (number === null) throw new Error('SVG stroke path contains an invalid coordinate.');
    const value = Number(number[0]);
    if (!Number.isFinite(value)) throw new Error('SVG stroke path contains an invalid coordinate.');
    tokens.push(value);
    index += number[0].length;
  }
  return tokens;
}

function isCommand(value: SvgCommand | number | string | undefined): value is SvgCommand {
  return typeof value === 'string' && COMMANDS.has(value as SvgCommand);
}

function isRelative(command: SvgCommand): boolean {
  return command === command.toLowerCase();
}

function samePoint(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y;
}

function reflect(point: Vec2, around: Vec2): Vec2 {
  return { x: around.x * 2 - point.x, y: around.y * 2 - point.y };
}
