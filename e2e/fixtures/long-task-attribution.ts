// Names the code behind each long task with a CPU profile (rolling audit v14
// Z1 follow-up). A shared CI runner has no GPU and a slower CPU: the job's
// own status renders cross 50 ms there with no camera at all, and WebGL runs
// in software, so a texture upload that a GPU does in the GPU process becomes
// UI-thread work. Long Animation Frame attribution names only the entry point
// (React's scheduler, a timer), not the code under it. A CPU profile's stacks
// do: a long task belongs to an area when that area's own script is on the
// stack in at least half of the samples taken during it. Samples whose
// deepest app frame is in a "driver" file (the overlay's thin WebGL wrapper)
// are left out: Chrome runs fast WebGL calls inside their caller's frame, so
// that file's time is the GPU's, which a CI runner without one does on the UI
// thread. Work with no script on the stack at all cannot be attributed and is
// guarded by structural checks instead.

import type { CDPSession, Page } from '@playwright/test';

interface CallFrame {
  readonly functionName: string;
  readonly url: string;
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: CallFrame;
  readonly children?: readonly number[];
}

interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly samples: readonly number[];
  readonly timeDeltas: readonly number[];
}

export interface TaskProfile {
  readonly cdp: CDPSession;
  /** performance.now() in the page when the marker function began. */
  readonly markedAt: number;
}

export interface LongTask {
  readonly startMs: number;
  readonly durationMs: number;
}

export interface AttributedTask extends LongTask {
  readonly samples: number;
  /** Share of the task's samples spent in the area's own script, 0..1. */
  readonly ownedShare: number;
  /** The area's functions most often deepest on the stack, with their sample counts. */
  readonly topOwned: readonly string[];
}

const MARKER = 'zzLongTaskProfileMarker';
const SAMPLING_US = 500;

/** Start sampling the page; a 30 ms marker ties the profile's clock to the page's. */
export async function startTaskProfile(page: Page): Promise<TaskProfile> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: SAMPLING_US });
  await cdp.send('Profiler.start');
  const markedAt = await page.evaluate(() => {
    // Named as MARKER: the profile finds its samples by this name.
    function zzLongTaskProfileMarker(): number {
      const at = performance.now();
      let spin = 0;
      while (performance.now() - at < 30) spin += Math.sqrt(spin + 1);
      return spin >= 0 ? at : Number.NaN;
    }
    return zzLongTaskProfileMarker();
  });
  return { cdp, markedAt };
}

export async function stopTaskProfile(profile: TaskProfile): Promise<CpuProfile> {
  const result = (await profile.cdp.send('Profiler.stop')) as { profile: CpuProfile };
  await profile.cdp.detach();
  return result.profile;
}

/**
 * Each task with the share of its samples in `ownedPath` script (a URL
 * fragment such as '/src/ui/camera/'), not counting samples whose deepest app
 * frame is in `driverPath`.
 */
export function attributeLongTasks(args: {
  readonly profile: CpuProfile;
  readonly markedAt: number;
  readonly tasks: readonly LongTask[];
  readonly ownedPath: string;
  readonly driverPath: string;
}): AttributedTask[] {
  const { profile } = args;
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const stack = (id: number): CallFrame[] => {
    const frames: CallFrame[] = [];
    for (let at: number | undefined = id; at !== undefined; at = parents.get(at)) {
      const node = nodes.get(at);
      if (node !== undefined) frames.push(node.callFrame);
    }
    return frames;
  };
  const times = sampleTimes(profile, stack, args.markedAt);
  const owned = (id: number): boolean => ownedSample(stack(id), args.ownedPath, args.driverPath);
  return args.tasks.map((task) => {
    const inside = times.filter(
      (sample) => sample.at >= task.startMs && sample.at <= task.startMs + task.durationMs,
    );
    const mine = inside.filter((sample) => owned(sample.id));
    return {
      ...task,
      samples: inside.length,
      ownedShare: inside.length === 0 ? 0 : mine.length / inside.length,
      topOwned: topFrames(
        mine.map((sample) => stack(sample.id)),
        args.ownedPath,
      ),
    };
  });
}

// The area's deepest frame in each stack, counted, most frequent first.
function topFrames(stacks: readonly CallFrame[][], ownedPath: string): string[] {
  const counts = new Map<string, number>();
  for (const frames of stacks) {
    const frame = frames.find((candidate) => candidate.url.includes(ownedPath));
    if (frame === undefined) continue;
    const file = frame.url.split(ownedPath).pop()?.split('?')[0] ?? frame.url;
    const name = `${frame.functionName || '(anonymous)'} ${file}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, count]) => `${name} x${count}`);
}

// Page times of the samples: the first sample inside the marker is markedAt.
function sampleTimes(
  profile: CpuProfile,
  stack: (id: number) => CallFrame[],
  markedAt: number,
): { readonly id: number; readonly at: number }[] {
  let elapsedUs = 0;
  const raw = profile.samples.map((id, index) => {
    elapsedUs += profile.timeDeltas[index] ?? 0;
    return { id, us: elapsedUs };
  });
  const first = raw.find((sample) =>
    stack(sample.id).some((frame) => frame.functionName === MARKER),
  );
  if (first === undefined) throw new Error('the profile holds no sample of its clock marker');
  return raw.map((sample) => ({ id: sample.id, at: markedAt + (sample.us - first.us) / 1000 }));
}

// The area's own script: an app frame of it on the stack, unless the deepest
// app frame is the driver file's (its WebGL calls, native or run in its frame).
function ownedSample(frames: readonly CallFrame[], ownedPath: string, driverPath: string): boolean {
  if (!frames.some((frame) => frame.url.includes(ownedPath))) return false;
  const deepestApp = frames.find((frame) => frame.url.includes('/src/'));
  return deepestApp === undefined || !deepestApp.url.includes(driverPath);
}
