/**
 * Static source audit: `scene.canvas.width` / `scene.canvas.height` are for document/
 * canvas rendering. Machine-coordinate paths must use `resolveBedWidthMm` /
 * `resolveBedHeightMm` (see e427a0a). After e427a0a, a grep-based guard prevents
 * reintroducing Frame vs Burn bed divergence.
 *
 * Run: npx tsx tests/scene-canvas-machine-coord-check.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

const PATTERN = /\bscene\.canvas\.(width|height)\b/;

/**
 * Files that legitimately read scene canvas size for **rendering, UI layout in
 * design space, import/export, or “document” bounds** — not machine G-code.
 * Keep in sync: any new `scene.canvas.width/height` under `src/` is either
 * allowlisted here or migrated to the bed resolver.
 */
const SCENE_CANVAS_ALLOWLIST: string[] = [
  // Renders the visible bed grid / outline in editor space.
  'src/ui/renderers/SceneRenderer.ts',
  // Viewport fit, pan/zoom, and the bed rectangle in the web canvas.
  'src/ui/components/CanvasViewport.tsx',
  // New-project and placement bounds; uses current scene’s document size.
  'src/ui/components/FileToolbar.tsx',
  // Root: text placement default in canvas; profile dialog initial dims fallback.
  'src/ui/components/App.tsx',
  // File → import: scale / center within the document.
  'src/ui/hooks/useImport.ts',
  // Fit-to-view fallback when the scene is empty: uses document (canvas) bounds.
  'src/geometry/bounds.ts',
  // SVG import: default bounds in scene coordinates.
  'src/import/svg/SvgToScene.ts',
  // SVG export page size in scene space.
  'src/io/SvgExporter.ts',
  // New untitled project keeps same “paper” size as the current document.
  'src/ui/hooks/useFileHandlers.ts',
  // Generator tools (grid etc.) use scene extents for object placement.
  'src/ui/hooks/useGeneratorHandlers.ts',
  // Centering, alignment, distribute — in design canvas coordinates.
  'src/ui/hooks/useSceneOperations.ts',
  // Material / placement in document space.
  'src/ui/hooks/useMaterialHandlers.ts',
  // Overlays, kerf and material test positioning on the artboard.
  'src/ui/components/KerfWizard.tsx',
  'src/ui/components/MaterialTestDialog.tsx',
  // Nesting: default bin = scene or material; scene side is “sheet” in doc space.
  'src/ui/components/NestingDialog.tsx',
  // Camera overlay: corner calibration uses canvas extent as default world click.
  'src/ui/components/CameraDialog.tsx',
  // Read-only display of the scene’s stored canvas dimensions.
  'src/ui/components/StatusFooter.tsx',
];

function walkSrcTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSrcTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(
        path.relative(projectRoot, full).split(path.sep).join('/'),
      );
    }
  }
  return out;
}

const files = walkSrcTsFiles(path.join(projectRoot, 'src'));
const allowSet = new Set(SCENE_CANVAS_ALLOWLIST);

// ─── 1) No unauthorized scene.canvas width/height ─────────────────
const violations: { file: string; line: number; text: string }[] = [];
for (const rel of files) {
  if (allowSet.has(rel)) continue;
  const text = fs.readFileSync(path.join(projectRoot, rel), 'utf8');
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      violations.push({ file: rel, line: i + 1, text: lines[i].trim() });
    }
  }
}
if (violations.length > 0) {
  const msg = violations
    .map((v) => `  ${v.file}:${v.line}: ${v.text}`)
    .join('\n');
  throw new Error(
    `Unauthorized scene.canvas.width/height (machine / travel code must use resolveBedWidthMm / resolveBedHeightMm via PipelineService or runPreflightSummary bed args):\n${msg}\n\n` +
      'If the use is design-space / rendering only, add `src/...` to SCENE_CANVAS_ALLOWLIST in tests/scene-canvas-machine-coord-check.test.ts with a short comment.',
  );
}

// ─── 2) Allowlist entries must still match the pattern (not stale) ───
const stale: string[] = [];
for (const entry of SCENE_CANVAS_ALLOWLIST) {
  const full = path.join(projectRoot, ...entry.split('/'));
  if (!fs.existsSync(full)) {
    stale.push(`${entry} (file missing)`);
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  if (!PATTERN.test(text)) {
    stale.push(`${entry} (no scene.canvas.width/height — remove from allowlist)`);
  }
}
if (stale.length > 0) {
  throw new Error(
    `Stale SCENE_CANVAS_ALLOWLIST entries:\n  ${stale.join('\n  ')}`,
  );
}

console.log('\n=== scene.canvas width/height machine-coord check ===');
console.log(`  ✓ ${files.length} files under src/ scanned`);
console.log(`  ✓ ${SCENE_CANVAS_ALLOWLIST.length} allowlisted rendering/design paths`);
process.stdout.write('\nScene canvas machine-coord: OK\n');
