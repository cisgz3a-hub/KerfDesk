// EXPLORATION ONLY (track OR) — scans real emitter output for every catalog profile.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { GRBL_MACHINE_PROFILE_CATALOG } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project, type SceneObject } from '../../core/scene';
import { createEllipse, createRectangle } from '../../core/shapes/primitives';

const OUT = '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/OR/catalog.txt';
const log = (text: string) => appendFileSync(OUT, text + '\n');

const COLORS = { fill: '#000000', line: '#ff0000', image: '#808080' } as const;
function artwork(): SceneObject[] {
  return [
    createRectangle({ id: 'fill', color: COLORS.fill, transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 }, spec: { widthMm: 8, heightMm: 5, cornerRadiusMm: 0 } }),
    createEllipse({ id: 'line', color: COLORS.line, transform: { ...IDENTITY_TRANSFORM, x: 35, y: 22 }, spec: { widthMm: 5, heightMm: 4 } }),
    {
      kind: 'raster-image', id: 'photo', color: COLORS.image, source: 'photo.png',
      dataUrl: 'data:image/png;base64,x',
      lumaBase64: Buffer.from([0, 64, 128, 255, 255, 128, 64, 0, 32, 96, 160, 223, 223, 160, 96, 32]).toString('base64'),
      pixelWidth: 4, pixelHeight: 4, bounds: { minX: 50, minY: 30, maxX: 54, maxY: 34 },
      transform: IDENTITY_TRANSFORM, dither: 'grayscale', linesPerMm: 2,
    } as SceneObject,
  ];
}
function mixedProject(device: Project['device'], air: boolean, constantLine: boolean): Project {
  const base = createProject(device);
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: artwork(),
      layers: [
        { ...createLayer({ id: 'fill', color: COLORS.fill, mode: 'fill' }), hatchSpacingMm: 0.5, power: 40, passes: 2, airAssist: air },
        { ...createLayer({ id: 'line', color: COLORS.line, mode: 'line' }), ...(constantLine ? { powerMode: 'constant' as const } : {}), speed: 600, power: 60, passes: 2, airAssist: false },
        { ...createLayer({ id: 'image', color: COLORS.image, mode: 'image' }), ditherAlgorithm: 'grayscale', linesPerMm: 2, imageBidirectional: true, power: 100, speed: 1200, airAssist: air },
      ],
    },
  } as Project;
}
function execPart(line: string): string {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').replace(/\s+/g, '').toUpperCase();
}
it('scans', () => {
  writeFileSync(OUT, '');
  for (const entry of GRBL_MACHINE_PROFILE_CATALOG) {
    const device = entry.profile;
    for (const air of [false, true]) {
      const project = mixedProject(device, air, true);
      const prepared = prepareOutput(project);
      if (!prepared.ok) { log(`${device.profileId} air=${air}: prepare failed ${JSON.stringify(prepared.preflight.issues.map((i) => i.code))}`); continue; }
      const { gcode } = emitPreparedGcode(prepared);
      const lines = gcode.split('\n');
      let maxLen = 0; let maxLine = '';
      const mWords = new Set<string>(); const gWords = new Set<string>(); let maxS = 0; const odd: string[] = [];
      for (const raw of lines) {
        const e = execPart(raw);
        if (e.length > maxLen) { maxLen = e.length; maxLine = raw; }
        for (const m of e.matchAll(/M(\d+(?:\.\d+)?)/g)) mWords.add('M' + m[1]);
        for (const m of e.matchAll(/G(\d+(?:\.\d+)?)/g)) gWords.add('G' + m[1]);
        for (const m of e.matchAll(/S(\d+(?:\.\d+)?)/g)) maxS = Math.max(maxS, Number(m[1]));
        if (/E[+-]?\d/.test(e.replace(/^[^E]*$/, '')) && /\dE/.test(e)) odd.push(raw);
        if (e.startsWith('%') || /[^A-Z0-9.\-+ ]/.test(e)) odd.push(raw);
      }
      log(`${device.profileId} kind=${device.controllerKind ?? '(none)'} dialect=${device.gcodeDialect.dialectId} baud=${device.baudRate ?? '(default)'} maxS=${device.maxPowerS} bed=${device.bedWidth}x${device.bedHeight} air=${device.airAssistCommand} airOn=${air}: lines=${lines.length} maxExecLen=${maxLen} [${maxLine.trim()}] M=${[...mWords].join(',')} G=${[...gWords].join(',')} maxS=${maxS} odd=${odd.slice(0,3).join(' | ')}`);
      if (air && (device.profileId === 'generic-grbl-400x400' || device.profileId === 'neotronics-4040-max-lt4lds-v2-20w' || device.profileId === 'creality-falcon-a1-pro-grblhal')) log(gcode);
    }
  }
});
