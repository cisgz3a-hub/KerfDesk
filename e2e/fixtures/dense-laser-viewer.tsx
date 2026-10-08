import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { InspectorView } from '../../src/ui/gcode-inspector/InspectorView';
import { inspectGcodeOffThread } from '../../src/ui/gcode-inspector/gcode-inspector-worker-client';
import { hasGcodeInspectorAnalysis } from '../../src/ui/gcode-inspector/gcode-inspector-worker-protocol';

// A line engraving with hundreds of thousands of short, mostly dark moves.
// Its rapids cover the blank parts of the design just as a scan fill does.
export function denseLaserProgram(): string {
  const columns = 576;
  const rows = 638;
  const lines = ['G21 G90', 'M4 S500', 'G0 X0 Y0', 'F3000'];
  for (let row = 0; row < rows; row += 1) {
    const y = (row * 195) / (rows - 1);
    lines.push(`G0 Y${y.toFixed(3)}`);
    for (let step = 1; step <= columns; step += 1) {
      const x = ((row % 2 === 0 ? step : columns - step) * 196) / columns;
      const dx = x - 98;
      const dy = y - 97.5;
      const radius = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      const ring = Math.abs(radius - 72) < 0.4 || Math.abs(radius - 80) < 0.4;
      const petal =
        radius > 15 && radius < 70 && Math.abs(Math.sin(angle * 8 + radius / 15)) < 0.06;
      const core = Math.abs(radius - 12) < 0.4 || Math.abs(radius - 20) < 0.4;
      lines.push(`${ring || petal || core ? 'G1' : 'G0'} X${x.toFixed(3)}`);
    }
  }
  lines.push('M5');
  return lines.join('\n');
}

/** Mount the production Inspector using its real parsing/timing worker. */
export async function mountLaserViewer(text: string): Promise<number> {
  const capability = document.querySelector<HTMLMetaElement>(
    'meta[name="kerfdesk-build-capabilities"]',
  )?.content;
  if (capability !== 'desktop') {
    throw new Error(
      'The density fixture requires Vite --mode desktop; browser-free strips InspectorView.',
    );
  }
  const source = { kind: 'text' as const, text, machineKind: 'laser' as const };
  const pending = inspectGcodeOffThread(source);
  if (pending === null) throw new Error('Inspector worker unavailable');
  const result = await pending;
  if (!hasGcodeInspectorAnalysis(result)) throw new Error(result.parsed.reason);
  const host = document.createElement('div');
  host.id = 'density-viewer-fixture';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10000',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'var(--lf-font)',
  });
  document.body.append(host);
  flushSync(() =>
    createRoot(host).render(
      <InspectorView
        variant="preview"
        model={result.parsed.model}
        analysis={result.analysis}
        source={source}
      />,
    ),
  );
  return result.parsed.model.segmentCount;
}

/** Read the presented PNG, without making WebGL draw a replacement frame. */
export async function screenshotColours(data: string): Promise<{ red: number; cut: number }> {
  const image = new Image();
  image.src = `data:image/png;base64,${data}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Screenshot decoder unavailable');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let red = 0;
  let cut = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at] ?? 0;
    const g = pixels[at + 1] ?? 0;
    const b = pixels[at + 2] ?? 0;
    if (r > g + 20 && r > b + 20) red += 1;
    if (b > r + 20 && b > g + 8) cut += 1;
  }
  return { red, cut };
}
