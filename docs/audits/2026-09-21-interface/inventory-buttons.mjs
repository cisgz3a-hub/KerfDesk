// Rebuild from the repository root: node docs/audits/2026-09-21-interface/inventory-buttons.mjs
// A source inventory is not runtime or hardware qualification.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import ts from 'typescript';
import prettier from 'prettier';

const root = process.cwd();
const destination = path.resolve(root, process.argv[2] ?? 'docs/audits/2026-09-21-interface');
const slash = (value) => value.replaceAll('\\', '/');
const relative = (value) => slash(path.relative(root, value));
const findingsLink = slash(
  path.relative(
    destination,
    path.join(root, 'docs/audits/2026-09-21-interface/button-findings.md'),
  ),
);
const compact = (value) => value.replace(/\s+/g, ' ').trim();
const testPattern = /\.(?:test|spec)\.[jt]sx?$/;
const controls = [];
const commandReferences = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

const files = walk(path.join(root, 'src'))
  .filter((file) => /\.[jt]sx?$/.test(file))
  .sort();
const tests = files.filter((file) => testPattern.test(file));
const sources = files.filter((file) => !testPattern.test(file) && !file.includes('__fixtures__'));
const textByFile = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));

function testPointers(file) {
  const directory = path.dirname(file);
  const stem = path.basename(file).replace(/\.[jt]sx?$/, '');
  return tests
    .filter((test) => {
      if (path.dirname(test) !== directory) return false;
      const name = path.basename(test);
      return name.startsWith(`${stem}.`) || textByFile.get(test).includes(`from './${stem}'`);
    })
    .map(relative);
}

function enclosingFunction(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isVariableDeclaration(current) && current.initializer) return current.name.getText();
  }
  return '(module)';
}

function attributes(node) {
  const values = {};
  const spreads = [];
  for (const attribute of node.attributes.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) spreads.push(compact(attribute.expression.getText()));
    else {
      const initial = attribute.initializer;
      values[attribute.name.getText()] =
        initial === undefined
          ? 'true'
          : ts.isStringLiteral(initial)
            ? initial.text
            : compact(initial.expression?.getText() ?? initial.getText());
    }
  }
  return { values, spreads };
}

function childLabel(node) {
  const children = ts.isJsxOpeningElement(node) ? node.parent.children : [];
  return compact(
    children
      .map((child) => {
        if (ts.isJsxText(child)) return child.text;
        if (ts.isJsxExpression(child))
          return child.expression ? `{${compact(child.expression.getText())}}` : '';
        if (ts.isJsxElement(child)) return childLabel(child.openingElement);
        return '';
      })
      .join(' '),
  );
}

function conditions(node) {
  const result = [];
  for (let current = node; current.parent && result.length < 4; current = current.parent) {
    const parent = current.parent;
    if (ts.isConditionalExpression(parent)) {
      result.push(
        `${current === parent.whenFalse ? 'not ' : ''}${compact(parent.condition.getText())}`,
      );
    } else if (
      ts.isBinaryExpression(parent) &&
      parent.right === current &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      result.push(compact(parent.left.getText()));
    }
    if (ts.isFunctionDeclaration(parent)) break;
  }
  return result;
}

function kindFor(tag, values) {
  if (tag === 'button') return 'native-button';
  if (tag === 'summary') return 'disclosure';
  if (tag === 'a' && (values.href || values.onClick)) return 'link';
  if (tag === 'input' && /^(button|submit|reset|checkbox|radio)$/.test(values.type))
    return 'input-control';
  if (/(^|\.)[\w]*Button$/.test(tag)) return 'button-component-call';
  if (values.role && /button|menuitem|tab|switch/.test(values.role)) return 'semantic-control';
  if (values.onClick || values.onDoubleClick || values.onPointerDown || values.onMouseDown)
    return 'other-interactive';
  return null;
}

function potentialFindings(tag, kind, values, spreads, label, handlers) {
  const findings = [];
  const nativeButton = tag === 'button';
  const submit = values.type === 'submit' || values.type === 'reset';
  if (nativeButton && !submit && Object.keys(handlers).length === 0 && spreads.length === 0)
    findings.push('no-direct-handler-review');
  if (nativeButton && !label && !values['aria-labelledby'] && spreads.length === 0)
    findings.push('no-direct-accessible-name-review');
  if (Object.values(handlers).some((handler) => /^(\([^)]*\)|\w+)\s*=>\s*\{\s*\}$/.test(handler)))
    findings.push('empty-handler-review');
  if (nativeButton && values.type === undefined && spreads.length === 0)
    findings.push('implicit-button-type-review');
  if (
    kind === 'other-interactive' &&
    /^[a-z]/.test(tag) &&
    !values.role &&
    !['canvas', 'svg', 'input'].includes(tag)
  )
    findings.push('nonsemantic-click-target-review');
  return findings;
}

function addControl(node, source, file) {
  const tag = node.tagName.getText(source);
  const { values, spreads } = attributes(node);
  const kind = kindFor(tag, values);
  if (!kind) return;
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  const label = values['aria-label'] || values.label || childLabel(node) || values.title || '';
  const handlers = Object.fromEntries(
    Object.entries(values).filter(([name]) =>
      /^on(?:Click|DoubleClick|Pointer|Mouse|Key|Change)/.test(name),
    ),
  );
  controls.push({
    id: `${relative(file)}:${location.line + 1}:${location.character + 1}`,
    area: relative(file).split('/')[2] ?? 'entry',
    file: relative(file),
    line: location.line + 1,
    component: enclosingFunction(node),
    kind,
    tag,
    label,
    handlers,
    disabled: values.disabled ?? values['aria-disabled'] ?? null,
    visibilityConditions: conditions(node),
    title: values.title ?? null,
    helpId: values['data-help-id'] ?? null,
    tutorialId: values.tutorialId ?? values.topicId ?? null,
    href: values.href ?? null,
    spreadProps: spreads,
    testPointers: testPointers(file),
    evidence: 'source-inventory-only',
    reviewFlags: potentialFindings(tag, kind, values, spreads, label, handlers),
  });
}

const typeSourcePath = path.join(root, 'src/ui/commands/command-types.ts');
const typeSource = ts.createSourceFile(
  typeSourcePath,
  textByFile.get(typeSourcePath),
  ts.ScriptTarget.Latest,
  true,
);
const commandIds = [];
function getCommandIds(node) {
  if (ts.isTypeAliasDeclaration(node) && node.name.text === 'CommandId') {
    for (const type of node.type.types)
      if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal))
        commandIds.push(type.literal.text);
  }
  ts.forEachChild(node, getCommandIds);
}
getCommandIds(typeSource);
const commandSet = new Set(commandIds);

function addCommandReference(node, source, file) {
  if (!ts.isStringLiteral(node) || !commandSet.has(node.text)) return;
  if (!relative(file).startsWith('src/ui/commands/') || file === typeSourcePath) return;
  let ancestor = node.parent;
  while (
    ancestor &&
    !ts.isCallExpression(ancestor) &&
    !ts.isObjectLiteralExpression(ancestor) &&
    !ts.isTypeAliasDeclaration(ancestor)
  )
    ancestor = ancestor.parent;
  if (!ancestor || ts.isTypeAliasDeclaration(ancestor)) return;
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  commandReferences.push({
    id: node.text,
    file: relative(file),
    line,
    builder: enclosingFunction(node),
    expression: compact(ancestor.getText(source)),
    testPointers: testPointers(file),
  });
}

for (const file of sources) {
  const source = ts.createSourceFile(file, textByFile.get(file), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      addControl(node, source, file);
    addCommandReference(node, source, file);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const commands = commandIds.map((id) => ({
  id,
  family: id.split('.')[0],
  registrationReferences: commandReferences.filter((entry) => entry.id === id),
  testPointers: tests.filter((test) => textByFile.get(test).includes(`'${id}'`)).map(relative),
  evidence: 'source-inventory-only',
}));
const countBy = (entries, key) =>
  Object.fromEntries(
    [...new Set(entries.map((entry) => entry[key]))]
      .sort()
      .map((value) => [value, entries.filter((entry) => entry[key] === value).length]),
  );
const metadata = {
  scope:
    'All src TypeScript/JavaScript except named .test/.spec files and __fixtures__; includes test-support/helper modules. Catalogs JSX controls and CommandId registrations.',
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDigest: createHash('sha256')
    .update(sources.map((file) => `${relative(file)}\n${textByFile.get(file)}`).join('\n'))
    .digest('hex'),
  sourceFilesScanned: sources.length,
  controlDefinitions: controls.length,
  commandIds: commands.length,
  definitionsByKind: countBy(controls, 'kind'),
  definitionsByArea: countBy(controls, 'area'),
  controlsWithTestPointers: controls.filter((control) => control.testPointers.length > 0).length,
  controlsFlaggedForReview: controls.filter((control) => control.reviewFlags.length > 0).length,
  limitations: [
    'Static source definitions, not the number of visible buttons or distinct runtime instances. Reusable definitions and their call sites intentionally coexist.',
    'Mapped lists, conditional rendering, spread props, inherited native behavior and hook callbacks require runtime checking.',
    'Visibility conditions list JSX ancestor guards only; early returns, parent-component prerequisites and dynamically generated names are not fully resolved.',
    'Nearby tests are discovery pointers, never proof that a specific control passed. Test results are reported separately.',
    'Review flags are heuristic candidates, not confirmed defects. Input text/range/select fields, canvas gestures and native desktop menus are outside this button catalog.',
    'No hardware, controller, material, or external-service operation was performed for this inventory.',
  ],
};

fs.mkdirSync(destination, { recursive: true });
const jsonOptions = {
  ...(await prettier.resolveConfig(path.join(destination, 'buttons.json'))),
  parser: 'json',
};
const markdownOptions = {
  ...(await prettier.resolveConfig(path.join(destination, 'buttons.md'))),
  parser: 'markdown',
};
fs.writeFileSync(
  path.join(destination, 'buttons.json'),
  await prettier.format(JSON.stringify({ metadata, controls, commands }), jsonOptions),
);
const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const columns = [
  'id',
  'area',
  'component',
  'kind',
  'label',
  'handlers',
  'disabled',
  'visibilityConditions',
  'title',
  'helpId',
  'testPointers',
  'evidence',
  'reviewFlags',
];
fs.writeFileSync(
  path.join(destination, 'buttons.csv'),
  [
    columns.join(','),
    ...controls.map((control) =>
      columns
        .map((column) =>
          csvEscape(
            typeof control[column] === 'object' ? JSON.stringify(control[column]) : control[column],
          ),
        )
        .join(','),
    ),
  ].join('\n') + '\n',
);
const summaryLines = [
  '# Interface control inventory',
  '',
  `Scanned ${metadata.sourceFilesScanned} source files, excluding named .test/.spec files and __fixtures__ but including helper modules. Found **${metadata.controlDefinitions} control definitions and component calls** across ${Object.keys(metadata.definitionsByArea).length} UI areas, plus **${metadata.commandIds} command IDs**. These are source records, not visible button counts or runtime passes.`,
  '',
  `Base commit: \`${metadata.sourceHead}\`. SHA-256 of scanned paths and source contents: \`${metadata.sourceDigest}\`.`,
  '',
  `[Full control and command records](buttons.json) include source location, label expression, handler, disabled expression, visibility conditions, help and test pointers. [CSV](buttons.csv) supports filtering the control records. [Findings and verification](${findingsLink}) records functional evidence separately.`,
  '',
  '## Coverage of the source inventory',
  '',
  '| Area | Source records | Records with nearby test pointers | Distinct nearby test files |',
  '| --- | ---: | ---: | ---: |',
  ...Object.entries(metadata.definitionsByArea).map(([area, count]) => {
    const areaControls = controls.filter((control) => control.area === area);
    return `| ${area} | ${count} | ${areaControls.filter((control) => control.testPointers.length > 0).length} | ${new Set(areaControls.flatMap((control) => control.testPointers)).size} |`;
  }),
  '',
  '| Record kind | Count |',
  '| --- | ---: |',
  ...Object.entries(metadata.definitionsByKind).map(([kind, count]) => `| ${kind} | ${count} |`),
  '',
  `${metadata.controlsWithTestPointers} records have nearby test pointers; ${metadata.controlDefinitions - metadata.controlsWithTestPointers} do not. A pointer is a navigation aid, not measured test coverage. ${metadata.controlsFlaggedForReview} records have heuristic review flags; their disposition is in the findings document.`,
  '',
  '## Command index',
  '',
  'Every CommandId is indexed below. Enabled/disabled builder calls and callback expressions are retained in the JSON, including condition-dependent branches. A mapped array can produce many runtime buttons from one source definition.',
  '',
  '| Command | Registration references | Explicit ID test references |',
  '| --- | ---: | ---: |',
  ...commands.map(
    (command) =>
      `| ${command.id} | ${command.registrationReferences.length} | ${command.testPointers.length} |`,
  ),
  '',
  '## Rebuild and limits',
  '',
  'Run from the repository root:',
  '',
  '```sh',
  'node docs/audits/2026-09-21-interface/inventory-buttons.mjs',
  '```',
  '',
  ...metadata.limitations.map((limitation) => `- ${limitation}`),
  '',
];
fs.writeFileSync(
  path.join(destination, 'buttons.md'),
  await prettier.format(summaryLines.join('\n'), markdownOptions),
);
console.log(JSON.stringify(metadata, null, 2));
