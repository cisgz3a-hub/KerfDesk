// Frame on a rotary with a dedicated A or Z axis (ADR-695). The framed job's
// Y slot is the part's turn, zeroed at the turn the part is at now, exactly
// as the job will be: the Frame starts with the same `G92 A0`, traces the
// perimeter with the turn written under the axis letter, and always comes back
// to turn 0, so the job's own `G92 A0` zeroes the turn that was framed. The
// head's Y is never commanded; it stays over the part.

import type { FrameBounds } from '../../core/controllers/controller-driver';
import type { JogParams } from '../../core/controllers/grbl';
import { rotaryAxisSupported } from '../../core/devices/rotary-axis';
import type { DedicatedRotaryAxis } from '../../core/devices/rotary';
import {
  axisLettersFromAxsField,
  axisLettersFromBuildInfoLines,
  rotaryAxisMissingMessage,
  rotaryAxisReportVerdict,
  type ReportedControllerAxes,
} from '../../core/devices/rotary-axis';
import { buildFramePerimeter } from '../../core/job/frame-perimeter';
import { rotaryAxisZeroLine, routeRotaryAxisLines } from '../../core/output/rotary-axis-output';
import type { Project } from '../../core/scene';
import { rotaryAxisUnsupportedMessage } from '../../io/gcode/rotary-axis-emit';
import type { CncFrameMotionPlan } from './cnc-frame-lines';
import type { LaserState } from './laser-store';

const RETURN_EPSILON = 1e-3;

type Point = { readonly x: number; readonly y: number };

export function rotaryAxisFramePlan(args: {
  readonly project: Pick<Project, 'device'>;
  readonly axis: DedicatedRotaryAxis;
  readonly toolOffLines: ReadonlyArray<string>;
  readonly perimeter: ReadonlyArray<string>;
  readonly bounds: FrameBounds;
  readonly returnTarget: Point | undefined;
  readonly feed: number;
  readonly buildJog: (params: JogParams) => string;
  /** What the connected controller says about its axes; absent: unknown. */
  readonly reported?: ReportedControllerAxes;
}): CncFrameMotionPlan {
  const { axis } = args;
  if (!rotaryAxisSupported(args.project.device, axis)) {
    return {
      kind: 'blocked',
      message: rotaryAxisUnsupportedMessage(args.project, axis) ?? 'Unsupported rotary axis.',
    };
  }
  const reported = args.reported ?? { statusAxisCount: null };
  if (rotaryAxisReportVerdict(axis, reported) === 'missing') {
    return { kind: 'blocked', message: rotaryAxisMissingMessage(axis, reported) };
  }
  const routed: string[] = [];
  for (const line of [...args.perimeter, returnLine(args)]) {
    if (line === null) continue;
    const next = routeRotaryAxisLines(line, axis);
    if (next.kind === 'conflict') {
      return {
        kind: 'blocked',
        message: `This controller's Frame already moves ${axis}, so a rotary on ${axis} cannot be framed.`,
      };
    }
    routed.push(next.text);
  }
  return {
    kind: 'ready',
    lines: [...args.toolOffLines, `${rotaryAxisZeroLine(axis)}\n`, ...routed],
  };
}

// Back to turn 0, and to the pre-Frame X when the Frame has one; nothing when
// the perimeter already ends there.
function returnLine(args: Parameters<typeof rotaryAxisFramePlan>[0]): string | null {
  const start = buildFramePerimeter(args.bounds, args.bounds.startPoint)[0];
  const x = args.returnTarget?.x;
  const xHome = x === undefined || Math.abs(x - start.x) < RETURN_EPSILON;
  if (xHome && Math.abs(start.y) < RETURN_EPSILON) return null;
  const jog = args.buildJog({
    ...(x === undefined ? {} : { dx: x }),
    dy: 0,
    feed: args.feed,
    relative: false,
  });
  return `${jog}\n`;
}

/** The Frame's bounds as the bed sees them: the head stays at its own Y. */
export function rotaryAxisBedFrameBounds(bounds: FrameBounds, headY: number): FrameBounds {
  const { startPoint: _start, ...rest } = bounds;
  return { ...rest, minY: headY, maxY: headY };
}

/** The axes the live controller reported: its status axis count, and grblHAL's
 *  `$I` AXS letters from the connect read or a Super Console report. */
export function reportedControllerAxes(
  state: Pick<LaserState, 'statusReport' | 'controllerFirmwareReport'> &
    Partial<Pick<LaserState, 'controllerBuildInfoRawLines'>>,
): ReportedControllerAxes {
  const axs = state.controllerFirmwareReport?.fields.find((field) => field.name === 'AXS');
  return {
    statusAxisCount: state.statusReport?.reportedAxisCount ?? null,
    axisLetters:
      axisLettersFromAxsField(axs?.value) ??
      axisLettersFromBuildInfoLines(state.controllerBuildInfoRawLines ?? []),
  };
}
