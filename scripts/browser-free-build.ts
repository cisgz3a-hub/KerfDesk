import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';

/** Pro entry points are replaced before bundling, including in workers. Shared
 * geometry used by Free tools stays available. Desktop retains the source bodies.
 * Explicit names and a source preflight make a rename fail the build, not unlock it. */
export const PRO_BUILD_ENTRIES: Readonly<Record<string, readonly string[]>> = {
  'src/ui/design-studio/DesignStudioHost.tsx': ['DesignStudioHost'],
  'src/ui/box/BoxGeneratorHost.tsx': ['BoxGeneratorHost'],
  'src/ui/gcode-inspector/InspectorView.tsx': ['InspectorView'],
  'src/ui/gcode-inspector/CanvasGcodeView.tsx': ['CanvasGcodeView'],
  'src/ui/camera/WorkspaceCameraOverlay.tsx': ['WorkspaceCameraOverlay'],
  'src/ui/camera/calibrate/CalibrateCameraControls.tsx': ['CalibrateCameraControls'],
  'src/ui/camera/OverlayControls.tsx': ['OverlayControls'],
  'src/ui/camera/panel/SavedCamerasSection.tsx': ['SavedCamerasSection'],
  'src/ui/camera/active-camera-model.ts': [
    'activeCameraModel',
    'ownCameraModel',
    'activeCameraModelNow',
    'useActiveCameraModel',
    'useOwnCameraModel',
  ],
  'src/core/cnc/vcarve-medial.ts': ['vcarveMedialPasses'],
  'src/core/cnc/vcarve-medial-work.ts': [
    'prepareVCarveMedialWork',
    'runVCarveMedialRegionTask',
    'finalizeVCarveMedialWork',
  ],
  'src/core/cnc/vcarve-ladder.ts': ['vcarvePasses', 'vcarveLadderPasses'],
  // Relief machining retains its existing boundary after the stage-module split.
  'src/core/cnc/compile-cnc-relief.ts': ['appendReliefPasses', 'reliefLadderFor'],
  'src/core/cnc/compile-cnc-relief-finishing.ts': ['reliefFinishingGroup', 'finishRelief'],
  'src/core/cnc/compile-cnc-relief-rest.ts': ['compileReliefRestGroup', 'restForRelief'],
  'src/core/cnc/compile-cnc-relief-projection.ts': ['compileReliefProjectionGroups'],
  'src/core/relief/relief-projection-plan.ts': ['reliefProjectionPlan'],
  'src/core/relief/relief-residual-stock.ts': ['predictReliefResidual'],
  'src/core/relief/relief-rest-passes.ts': ['reliefRestPasses'],
  'src/core/cnc/adaptive-pocket.ts': ['planAdaptivePocket'],
  'src/core/relief/relief-roughing.ts': ['reliefRoughingPasses', 'reliefRoughingLadder'],
  'src/core/relief/relief-finishing.ts': ['reliefFinishingPasses'],
  'src/core/relief/relief-finishing-strategy.ts': ['reliefFinishingPlan'],
  'src/core/box/generate-box.ts': ['generateBox'],
  'src/core/trace/photo-trace.ts': ['traceImageToPhotoPathsSteps'],
  'src/core/trace/colour-layer-trace.ts': ['traceColourLayersSteps'],
  'src/core/trace/centerline/trace-centerline.ts': [
    'traceCenterlineStrokePaths',
    'traceCenterlineStrokePathsSteps',
  ],
  'src/core/trace/edge-trace.ts': ['traceImageToEdgePaths', 'traceImageToEdgePathsSteps'],
  'src/core/trace/hybrid/trace-hybrid.ts': ['traceHybridPaths', 'traceHybridPathsSteps'],
  'src/core/trace/batch-trace.ts': ['traceImagesToVectorFiles'],
  // Legacy colour tracing is not a Free escape route around the new backends.
  'src/core/trace/trace-to-paths.ts': ['loadTracer', 'traceLegacyImageSteps'],
  'src/core/trace/trace-image.ts': ['traceImageToSvgString'],
};

export const DESKTOP_TOOL_MESSAGE = 'This tool is available in KerfDesk Pro for desktop.';

const TRACE_PRESETS_PATH = 'src/core/trace/trace-presets.ts';

/** Smooth and Sharp share Line Art's contour primitives. Remove their tuned
 * presets along with the dedicated Pro presets, keeping the Free primitives. */
export function replaceProTracePresets(source: string): string {
  const file = ts.createSourceFile(TRACE_PRESETS_PATH, source, ts.ScriptTarget.Latest, true);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'TRACE_PRESETS') continue;
      const presets = declaration.initializer;
      if (presets === undefined || !ts.isObjectLiteralExpression(presets)) break;
      const lineArt = presets.properties.find(
        (property) =>
          ts.isPropertyAssignment(property) &&
          ts.isStringLiteral(property.name) &&
          property.name.text === 'Line Art',
      );
      if (lineArt === undefined) break;
      return (
        source.slice(0, presets.getStart(file)) +
        `{ ${lineArt.getText(file)} }` +
        source.slice(presets.end)
      );
    }
  }
  throw new Error(`Free trace preset boundary changed in ${TRACE_PRESETS_PATH}`);
}

export function isBrowserFreeMode(mode: string, command: 'build' | 'serve' = 'build'): boolean {
  return mode !== 'desktop' && !(mode === 'test' && command === 'serve');
}

export function replaceProEntryBodies(source: string, path: string): string {
  const names = PRO_BUILD_ENTRIES[path];
  if (names === undefined) return source;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const pending = new Set(names);
  const edits: { start: number; end: number; body: string }[] = [];
  for (const statement of file.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined) continue;
    if (!pending.delete(statement.name.text)) continue;
    if (statement.body === undefined) throw new Error(`Missing Pro implementation: ${path}`);
    edits.push({
      start: statement.body.getStart(file),
      end: statement.body.end,
      body: path.startsWith('src/ui/')
        ? '{ return null; }'
        : `{ throw new Error(${JSON.stringify(DESKTOP_TOOL_MESSAGE)}); }`,
    });
  }
  if (pending.size > 0)
    throw new Error(`Pro build boundary changed in ${path}: ${[...pending].join(', ')}`);
  // React.lazy() declarations run at module scope. Merely replacing the host
  // body leaves their dynamic chunks in the graph, so UI entry modules contain
  // only their inert public hosts in Free, with no imported implementation.
  if (path.startsWith('src/ui/'))
    return names
      .map(
        (name) =>
          `export function ${name}() { return ${
            path.endsWith('/active-camera-model.ts') ? 'undefined' : 'null'
          }; }`,
      )
      .join('\n');
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.body + result.slice(edit.end);
  return result;
}

/** A fresh instance must be installed in worker.plugins too. */
export function browserFreeBuild(): Plugin {
  let free = false;
  let root = '';
  return {
    name: 'kerfdesk-browser-free',
    enforce: 'pre',
    config(_config, env) {
      return {
        define: {
          __KERFDESK_BROWSER_FREE__: JSON.stringify(isBrowserFreeMode(env.mode, env.command)),
        },
      };
    },
    configResolved(config) {
      free = isBrowserFreeMode(config.mode, config.command);
      root = config.root.replaceAll('\\', '/');
    },
    buildStart() {
      if (!free) return;
      replaceProTracePresets(readFileSync(resolve(root, TRACE_PRESETS_PATH), 'utf8'));
      for (const path of Object.keys(PRO_BUILD_ENTRIES))
        replaceProEntryBodies(readFileSync(resolve(root, path), 'utf8'), path);
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            name: 'kerfdesk-build-capabilities',
            content: free ? 'browser-free' : 'desktop',
          },
          injectTo: 'head',
        },
      ];
    },
    transform(source, id) {
      if (!free) return null;
      const normalized = id.replaceAll('\\', '/').split('?')[0] ?? '';
      if (!normalized.startsWith(`${root}/`)) return null;
      const path = normalized.slice(root.length + 1);
      if (path === TRACE_PRESETS_PATH) return { code: replaceProTracePresets(source), map: null };
      if (PRO_BUILD_ENTRIES[path] === undefined) return null;
      return { code: replaceProEntryBodies(source, path), map: null };
    },
  };
}
