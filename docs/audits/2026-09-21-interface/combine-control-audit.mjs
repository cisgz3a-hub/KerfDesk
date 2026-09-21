import fs from 'node:fs';
import console from 'node:console';
import prettier from 'prettier';

const base = 'docs/audits/2026-09-21-interface';
const baseline = JSON.parse(fs.readFileSync(`${base}/buttons.json`, 'utf8'));
const current = JSON.parse(fs.readFileSync(`${base}/current-source/buttons.json`, 'utf8'));
const names = ['shell', 'machine', 'artwork', 'studios'];
const matrices = names.map((name) => ({
  name,
  data: JSON.parse(fs.readFileSync(`${base}/control-audit-${name}.json`, 'utf8')),
}));
const rows = matrices.flatMap(({ name, data }) =>
  data.controls.map((control) => ({ ...control, auditArea: name })),
);
const valid = new Set([
  'verified-behaviour',
  'verified-boundary',
  'intentionally-unavailable',
  'defect-fixed',
  'needs-environment',
  'unverified',
  'not-action-control',
]);
const idSet = new Set(rows.map((row) => row.id));
if (rows.length !== baseline.controls.length || idSet.size !== rows.length)
  throw new Error('Duplicate or missing control IDs');
const rawReports = new Map();
for (const row of rows) {
  if (!baseline.controls.some((control) => control.id === row.id))
    throw new Error(`Unknown baseline ID: ${row.id}`);
  if (!valid.has(row.disposition)) throw new Error(`Unknown disposition: ${row.disposition}`);
  if (!row.expectedOutcome?.trim()) throw new Error(`Missing expected outcome: ${row.id}`);
  if (
    ['verified-behaviour', 'verified-boundary', 'defect-fixed'].includes(row.disposition) &&
    !row.evidence?.length
  )
    throw new Error(`No evidence: ${row.id}`);
  for (const evidence of row.evidence ?? []) {
    if (evidence.result !== 'passed' || !evidence.report) continue;
    const reportPath = fs.existsSync(evidence.report)
      ? evidence.report
      : `${base}/${evidence.report}`;
    if (!rawReports.has(reportPath))
      rawReports.set(reportPath, JSON.parse(fs.readFileSync(reportPath, 'utf8')));
    const report = rawReports.get(reportPath);
    const matching =
      report.testResults?.filter((suite) =>
        suite.name.replaceAll('\\', '/').endsWith(evidence.file),
      ) ?? [];
    if (
      !matching.some((suite) =>
        suite.assertionResults.some(
          (test) =>
            test.status === 'passed' &&
            (test.fullName === evidence.test || test.title === evidence.test),
        ),
      )
    )
      throw new Error(
        `Citation not found as a passing assertion: ${row.id}: ${evidence.test} in ${reportPath}`,
      );
  }
  const original = baseline.controls.find((control) => control.id === row.id);
  const beforeInFile = baseline.controls.filter((control) => control.file === original.file);
  const nowInFile = current.controls.filter((control) => control.file === original.file);
  if (beforeInFile.length !== nowInFile.length)
    throw new Error(`Control count changed in ${original.file}; explicit reconciliation required`);
  const updated = nowInFile[beforeInFile.findIndex((control) => control.id === row.id)];
  if (original.tag !== updated.tag || original.component !== updated.component)
    throw new Error(`Control order changed in ${original.file}; explicit reconciliation required`);
  row.area = original.area;
  row.source = {
    file: original.file,
    baselineLine: original.line,
    currentLine: updated.line,
    currentLabel: updated.label,
    handler: updated.handlers,
    disabled: updated.disabled,
    visibilityConditions: updated.visibilityConditions,
  };
}
if (current.controls.length !== baseline.controls.length)
  throw new Error('Current source gained or lost controls outside the original files');
const count = (items, field) =>
  Object.fromEntries(
    [...new Set(items.map((item) => item[field]))]
      .sort()
      .map((key) => [key, items.filter((item) => item[field] === key).length]),
  );
const commands = JSON.parse(fs.readFileSync(`${base}/control-audit-commands.json`, 'utf8'));
const metadata = {
  completedDate: '2026-09-22',
  worktree: 'D:\\LaserForge\\ui-audit-20260921',
  sourceHead: baseline.metadata.sourceHead,
  baselineSourceDigest: baseline.metadata.sourceDigest,
  currentSourceDigest: current.metadata.sourceDigest,
  controlDefinitionsAndCalls: rows.length,
  commands: commands.commands.length,
  counts: count(rows, 'disposition'),
  byArea: count(rows, 'area'),
  limits: [
    'A source definition or reusable call is not the same as a unique visible button. Dynamic families and shared-component boundaries are identified per row.',
    'Verified-behaviour means the stated software behavior in the cited case passed. It does not imply every conditional state, machine firmware, imported file or external environment was tested.',
    'Verified-boundary means only the stated callback, adapter, shared-component, simulator or availability boundary was exercised; native/physical outcomes remain unqualified.',
    'No real machine, laser/spindle, homing, probing, cutting, native installer, live camera or deployment was operated.',
  ],
};
const jsonOptions = {
  ...(await prettier.resolveConfig(`${base}/control-audit.json`)),
  parser: 'json',
};
fs.writeFileSync(
  `${base}/control-audit.json`,
  await prettier.format(
    JSON.stringify({ metadata, controls: rows, commands: commands.commands }),
    jsonOptions,
  ),
);
const csv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const columns = [
  'id',
  'area',
  'currentSource',
  'label',
  'disposition',
  'expectedOutcome',
  'availability',
  'evidence',
  'notes',
];
fs.writeFileSync(
  `${base}/control-audit.csv`,
  columns.join(',') +
    '\n' +
    rows
      .map((row) =>
        [
          row.id,
          row.area,
          `${row.source.file}:${row.source.currentLine}`,
          row.source.currentLabel || row.label,
          row.disposition,
          row.expectedOutcome,
          typeof row.availability === 'string'
            ? row.availability
            : JSON.stringify(row.availability),
          (row.evidence ?? [])
            .map(
              (evidence) =>
                `${evidence.file}: ${evidence.test ?? evidence.description ?? ''}${evidence.boundary ? ` [${evidence.boundary}]` : ''}`,
            )
            .join('\n'),
          row.notes,
        ]
          .map(csv)
          .join(','),
      )
      .join('\n') +
    '\n',
);
fs.writeFileSync(
  `${base}/control-audit-summary.json`,
  await prettier.format(JSON.stringify(metadata), jsonOptions),
);
console.log(JSON.stringify(metadata));
const description = {
  'verified-behaviour':
    'The stated local UI, store, geometry or explicitly simulated outcome passed.',
  'verified-boundary':
    'The stated callback, adapter, shared component or availability boundary passed; downstream effects remain outside that case.',
  'defect-fixed': 'A reproduced defect was repaired and has passing regression evidence.',
  'intentionally-unavailable':
    'An unmounted legacy control or explicitly unsupported feature, with its reason recorded.',
  'not-action-control':
    'A container, label or gesture surface included by the scanner; not counted as a working button.',
  'needs-environment': 'Requires an environment unavailable to this local audit.',
  unverified: 'No adequate executed evidence yet.',
};
const markdown = `# Button-by-button functional audit

Completed 2026-09-22 in \`D:\\LaserForge\\ui-audit-20260921\`, branch \`codex/ui-audit-20260921\`.

All **${rows.length} baseline control definitions/component calls** across **${Object.keys(metadata.byArea).length} UI areas** are accounted for, plus **${commands.commands.length} registered commands** clicked through their actual menu rows. This is a control-level audit with exact outcomes and evidence, rather than an inference from nearby passing test files. A reusable button can appear in multiple records, and one mapped definition can produce many visible buttons.

| Disposition | Control records | Meaning |
| --- | ---: | --- |
${Object.entries(metadata.counts)
  .map(([key, value]) => `| ${key} | ${value} | ${description[key]} |`)
  .join('\n')}

The separate command matrix records 89 callback/navigation boundary passes, one real Learn-store outcome, and one deliberately unavailable Focus Test. These command checks overlap the menu/toolbar definitions and must not be added to the control count as unique visible buttons.

## Findings repaired in this deeper pass

1. **Image Studio layer buttons:** Up/Down remained enabled at the stack ends, and Merge was enabled on the bottom layer. Those clicks silently did nothing. Availability now follows the active layer index, and the last layer cannot be deleted. DOM/store regressions and a Chrome add/move/merge workflow pass.
2. **Material preset wizard:** Back discarded uncommitted settings/details. It now reads the current step into the draft before moving back. Power, air and tabs survive Back/Next and final Save; Cancel still preserves the saved preset. Invalid numeric drafts use the existing parser's normalization. Chrome and focused tests pass.
3. **Network camera alignment:** “Save & show on canvas” only persisted alignment. It now says “Save alignment” and explains source selection, Update still, and turning Overlay on when hidden. Actual camera acquisition remains a separate explicit action; this repair does not claim a live camera test.

The earlier setup-navigation, image-menu keyboard/transform-state, run-order accessibility, compact dock and Done changes remain part of this worktree. Done clears only a settled successful run's display; it preserves editable artwork, undo, history, Frame state and saved execution data. Software/simulator evidence for that lifecycle is in [the completion report](completion.md).

## Inspect the evidence

- [Complete filterable CSV](control-audit.csv): one row per baseline control, including current source location, expected effect, availability and test boundary.
- [Complete machine-readable record](control-audit.json): all controls, all command expectations, exact test names and retained raw results.
- [Shell/workspace](control-audit-shell.md), [machine/calibration](control-audit-machine.md), [artwork/materials](control-audit-artwork.md), and [studios/camera/text](control-audit-studios.md).
- [All 91 command dispatch expectations](control-audit-commands.md).
- [Current source inventory](current-source/buttons.json) and [retained baseline](buttons.json).
- [Integration checks, browser results and original failure dispositions](verification.md).

Initial failed reproductions and fixture failures remain in the raw JSON. The combined validator requires every cited passing assertion to exist in its named report, each baseline ID exactly once, and a one-to-one current-source reconciliation. Independent review narrowed mocked Frame/Start, origin, Home, Abort, Fire and persistence claims to their proven software boundaries.

## Limits

No physical controller, homing/probing/firing/cutting, live camera or optical calibration, native OS installer/updater, or production deployment was exercised. Button dispatch is not proof of those external effects. Native file/clipboard/permission dialogs and renderer/camera/worker adapters use the boundaries named in each record. Exhaustive combinations of firmware, imports and application state are outside this audit.

The changes are local and unmerged. The existing dirty primary checkout was preserved. The rebuilt preview is at http://127.0.0.1:57283/ on this machine.

## Reproduce the report

Keep the baseline inventory: its IDs identify the audited records even where source lines moved. Regenerate the current scan into its separate destination, then the four area matrices, command matrix, and combined report. Each generator validates its evidence selectors.

\`\`\`powershell
node docs/audits/2026-09-21-interface/inventory-buttons.mjs docs/audits/2026-09-21-interface/current-source
node docs/audits/2026-09-21-interface/build-shell-control-audit.mjs
node docs/audits/2026-09-21-interface/build-machine-control-audit.mjs
node docs/audits/2026-09-21-interface/build-artwork-control-audit.mjs
node docs/audits/2026-09-21-interface/build-studios-control-audit.mjs
node docs/audits/2026-09-21-interface/build-command-control-audit.mjs
node docs/audits/2026-09-21-interface/combine-control-audit.mjs
\`\`\`

Baseline source SHA-256: \`${metadata.baselineSourceDigest}\`. Current source SHA-256: \`${metadata.currentSourceDigest}\`.
`;
fs.writeFileSync(`${base}/control-audit.md`, markdown);
