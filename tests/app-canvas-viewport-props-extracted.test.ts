import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const builderPath = path.join(process.cwd(), 'src', 'ui', 'components', 'appCanvasViewportProps.ts');
const builderSource = fs.existsSync(builderPath) ? fs.readFileSync(builderPath, 'utf8') : '';
const canvasSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'CanvasViewport.tsx'), 'utf8');

assert(
  appSource.includes('buildAppCanvasViewportProps'),
  'App.tsx should use a CanvasViewport prop builder instead of a large inline object',
);
assert(
  builderSource.includes('buildAppCanvasViewportProps'),
  'appCanvasViewportProps should export buildAppCanvasViewportProps',
);
assert(
  builderSource.includes('CanvasViewportProps'),
  'appCanvasViewportProps should preserve CanvasViewport prop typing',
);
assert(
  canvasSource.includes('export interface CanvasViewportProps'),
  'CanvasViewportProps should be exported for the App prop builder',
);
