import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const overlayPath = path.join(process.cwd(), 'src', 'ui', 'components', 'AppDragDropOverlay.tsx');
const overlaySource = fs.existsSync(overlayPath) ? fs.readFileSync(overlayPath, 'utf8') : '';

assert(
  appSource.includes('AppDragDropOverlay'),
  'App.tsx should render the extracted drag/drop overlay component',
);
assert(
  !appSource.includes('Drop file to import (SVG, DXF, PNG, JPG, JSON)'),
  'App.tsx should not own drag/drop overlay copy or markup',
);
assert(
  overlaySource.includes('Drop file to import (SVG, DXF, PNG, JPG, JSON)'),
  'AppDragDropOverlay should preserve the import overlay copy',
);
assert(
  overlaySource.includes('pointerEvents'),
  'AppDragDropOverlay should remain non-interactive so it does not block drop handling',
);
