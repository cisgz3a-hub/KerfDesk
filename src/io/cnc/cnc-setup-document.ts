import { cncProgramGeometry } from './cnc-program-geometry';
import { cncProgramPreviewSvg } from './cnc-program-preview';
import type { Project } from '../../core/scene/project';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { encodeCanonicalBase64 } from '../../core/relief/depth-map-base64';
import {
  cncSetupPackage,
  cncSetupProgramDownloads,
  cncSetupProgramInstructions,
  escapeSetupText as escape,
  type CncSetupPackageInput,
} from './cnc-setup-package';
export { safeProgramFilename } from './cnc-program-filenames';
export type { CncSetupExportMode } from './cnc-setup-package';

export type CncSetupDocumentInput = CncSetupPackageInput & {
  readonly project: Project;
  readonly placementLabel: string;
  readonly jobOriginOffset?: { readonly x: number; readonly y: number };
  readonly warnings: ReadonlyArray<string>;
  readonly generatedAtIso: string;
};

/** One atomic offline setup package containing only exact programs already emitted from its Job. */
export function buildCncSetupDocument(input: CncSetupDocumentInput): {
  readonly html: string;
  readonly manifestJson: string;
  readonly programSha256: string;
} {
  const machine = input.project.machine;
  if (machine?.kind !== 'cnc') throw new Error('A CNC setup document requires CNC output.');
  if (input.gcode.length === 0) throw new Error('No executable program was prepared.');
  const setup = input.project.cncSetup ?? defaultCncMachiningSetup();
  const bundle = cncSetupPackage(input);
  const geometry = cncProgramGeometry(input.gcode, input.facts.toolPlan);
  const preview = cncProgramPreviewSvg(geometry, setup.fixtures);
  const manifest = {
    format: 'kerfdesk-cnc-program-manifest',
    schemaVersion: 2,
    generatedAtIso: input.generatedAtIso,
    units: 'mm-min-rpm',
    ...bundle.manifest,
    setup,
    stock: machine.stock,
    deviceName: input.project.device.name,
    dialect: input.project.device.gcodeDialect ?? 'grbl',
    sourceSha256: input.facts.sourceSha256,
    jobOriginOffset: input.jobOriginOffset,
    geometryCoverage: { incomplete: geometry.incomplete, disclosures: geometry.disclosures },
    placement: input.placementLabel,
    operations: input.facts.operations,
    toolPlan: input.facts.toolPlan,
    tools: input.facts.tools,
    warnings: packageWarnings(input, bundle.files, geometry.disclosures),
    qualification:
      'Software-generated program. Controller, fixture, material and physical-machine qualification are separate.',
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestName = bundle.filename.replace(/\.(gcode|nc)$/i, '') + '.manifest.json';
  const downloads = cncSetupProgramDownloads(bundle.files);
  const instructions = cncSetupProgramInstructions(bundle.mode, bundle.files, input.facts);
  const fixtures = setup.fixtures
    .map(
      (fixture) =>
        `<li>${escape(fixture.name)}: X ${fixture.xMm}, Y ${fixture.yMm}, ${fixture.widthMm} × ${fixture.heightMm} mm, Z ${fixture.bottomZMm} to ${fixture.topZMm} mm</li>`,
    )
    .join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(setup.name)} · CNC setup</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:30px auto;padding:0 20px;color:#161616}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:6px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}.downloads a{display:inline-block;margin:8px 15px 8px 0}small{overflow-wrap:anywhere}@media print{.downloads{display:none}body{margin:0;max-width:none}}</style></head><body><h1>${escape(setup.name)}</h1><p>${escape(bundle.filename)} · ${escape(input.generatedAtIso)} · ${bundle.mode === 'single-file' ? 'Single file with manual M0 changes' : 'Ordered separate-tool files'}</p><small>Combined reviewed program ${bundle.programSha256} · ${bundle.manifest.combinedProgram.byteLength} UTF-8 bytes</small><div class="downloads">${downloads}<a download="${escape(manifestName)}" href="data:application/json;base64,${encodeCanonicalBase64(new TextEncoder().encode(manifestJson))}">Download manifest</a></div><h2>Machine and stock</h2><p>${escape(input.project.device.name)} · ${machine.stock.widthMm} × ${machine.stock.heightMm} × ${machine.stock.thicknessMm} mm · ${escape(machine.stock.materialKey ?? 'Manual material')}</p><p>G54 · stock top Z0 · ${escape(input.placementLabel)}. Stock origin X ${machine.stock.originOffset.x}, Y ${machine.stock.originOffset.y} mm.</p><pre>${escape(setup.notes)}</pre><h2>Program preview</h2>${preview}<h2>Operation order</h2><table><thead><tr><th>#</th><th>Operation</th><th>Tool</th><th>Feed mm/min</th><th>Plunge mm/min</th><th>RPM</th><th>Safe Z mm</th><th>Passes</th></tr></thead><tbody>${operationRows(input)}</tbody></table>${instructions}<h2>Fixtures in program coordinates</h2>${fixtures.length === 0 ? '<p>No fixture envelopes were supplied.</p>' : `<ul>${fixtures}</ul>`}<h2>Review findings</h2><ul>${manifest.warnings.map((warning) => `<li>${escape(warning)}</li>`).join('')}</ul><p>${escape(manifest.qualification)}</p><details><summary>Complete manifest</summary><pre>${escape(manifestJson)}</pre></details></body></html>`;
  return { html, manifestJson, programSha256: bundle.programSha256 };
}

function operationRows(input: CncSetupDocumentInput): string {
  return input.facts.operations
    .map(
      (operation, index) =>
        `<tr><td>${index + 1}</td><td>${escape(operation.name)} (${escape(operation.cutType)})</td><td>${escape(operation.toolName ?? operation.toolId ?? 'Default bit')}</td><td>${operation.feedMmPerMin}</td><td>${operation.plungeMmPerMin}</td><td>${operation.spindleRpm}</td><td>${operation.safeZMm}</td><td>${operation.passCount}</td></tr>`,
    )
    .join('');
}
function packageWarnings(
  input: CncSetupDocumentInput,
  files: ReadonlyArray<{ readonly filename: string; readonly warnings: ReadonlyArray<string> }>,
  disclosures: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return [
    ...new Set([
      ...input.warnings,
      ...disclosures,
      ...files.flatMap((file) => file.warnings.map((warning) => `${file.filename}: ${warning}`)),
    ]),
  ];
}
