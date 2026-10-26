// What one artwork's emitted program runs: the F and S words on its powered
// G1 moves and how many times the path is cut. Tests that edit settings
// through the UI read the program, not the store, as their output oracle.
import type { Project } from '../../../core/scene';
import { emitGcode } from '../../../io/gcode/emit-gcode';

export type EmittedBurn = {
  readonly feeds: ReadonlyArray<number>;
  readonly powers: ReadonlyArray<number>;
  readonly cutMoves: number;
};

export function emittedBurn(project: Project, objectId?: string): EmittedBurn {
  const scoped =
    objectId === undefined
      ? project
      : {
          ...project,
          scene: {
            ...project.scene,
            objects: project.scene.objects.filter((object) => object.id === objectId),
          },
        };
  const { gcode } = emitGcode(scoped);
  const feeds = new Set<number>();
  const powers = new Set<number>();
  let cutMoves = 0;
  let feed: number | null = null;
  let power: number | null = null;
  for (const line of gcode.split('\n')) {
    const code = line.replace(/;.*$/, '').trim();
    feed = wordValue(code, 'F') ?? feed;
    power = wordValue(code, 'S') ?? power;
    if (!/^G0?1(?![0-9])/.test(code) || power === null || power <= 0) continue;
    cutMoves += 1;
    if (feed !== null) feeds.add(feed);
    powers.add(power);
  }
  return {
    feeds: [...feeds].sort((a, b) => a - b),
    powers: [...powers].sort((a, b) => a - b),
    cutMoves,
  };
}

function wordValue(code: string, word: 'F' | 'S'): number | null {
  const match = new RegExp(`${word}(-?[0-9.]+)`).exec(code);
  return match === null ? null : Number(match[1]);
}
