import fs from 'node:fs';
import console from 'node:console';
import ts from 'typescript';

const base = 'docs/audits/2026-09-21-interface';
const inventory = JSON.parse(fs.readFileSync(`${base}/buttons.json`, 'utf8')).commands;
const testPath = 'src/ui/commands/AppMenuBar.control-audit.test.tsx';
const source = ts.createSourceFile(
  testPath,
  fs.readFileSync(testPath, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
let expectations;
function literal(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => [property.name.text, literal(property.initializer)]),
    );
  throw new Error(`Unexpected independent expectation node ${node.getText(source)}`);
}
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'OUTCOMES')
    expectations = literal(node.initializer);
  ts.forEachChild(node, visit);
}
visit(source);
if (Object.keys(expectations ?? {}).length !== inventory.length)
  throw new Error('Independent command expectation count differs from the inventory');
const report = `${base}/control-audit-menu-vitest.json`;
const assertions = JSON.parse(fs.readFileSync(report, 'utf8')).testResults.flatMap(
  (suite) => suite.assertionResults,
);
function reportedCommandId(title) {
  const label = /^'([^']+)' clicks through the menu to the expected outcome$/.exec(title)?.[1];
  if (label === undefined) return null;
  // Vitest abbreviates long interpolated strings in displayed case names.
  // Resolve a shortened name only when the baseline has exactly one match.
  const matches = inventory.filter((command) =>
    label.endsWith('…') ? command.id.startsWith(label.slice(0, -1)) : command.id === label,
  );
  if (matches.length !== 1) throw new Error(`Ambiguous reported command: ${label}`);
  return matches[0].id;
}
const commands = inventory.map((command) => {
  const expected = expectations[command.id];
  if (!expected) throw new Error(`Missing independent expectation ${command.id}`);
  const assertion = assertions.find(
    (test) => reportedCommandId(test.title) === command.id && test.status === 'passed',
  );
  if (!assertion) throw new Error(`No passing menu click for ${command.id}`);
  const disposition =
    expected.special === 'unavailable'
      ? 'intentionally-unavailable'
      : expected.special === 'tutorials'
        ? 'verified-behaviour'
        : 'verified-boundary';
  return {
    id: command.id,
    family: command.family,
    disposition,
    expected,
    evidence: { file: testPath, test: assertion.fullName, report, result: 'passed' },
    boundary:
      expected.special === 'unavailable'
        ? 'Focus Test remains disabled with its explicit unimplemented-generator reason and never dispatches.'
        : expected.special === 'tutorials'
          ? 'Actual tutorial store opens the library; menu closes.'
          : 'Actual menu and registry dispatch. Expected callbacks, arguments, dirty guard and URL are independent test expectations; context callbacks and external navigation are mocked. Downstream geometry, persistence and machine effects require their own cases in the control matrices.',
  };
});
const counts = Object.fromEntries(
  [...new Set(commands.map((c) => c.disposition))].map((key) => [
    key,
    commands.filter((c) => c.disposition === key).length,
  ]),
);
fs.writeFileSync(
  `${base}/control-audit-commands.json`,
  JSON.stringify(
    { scope: 'Every registered CommandId clicked through the application menu', counts, commands },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(
  `${base}/control-audit-commands.md`,
  '# Registered command dispatch audit\n\nAll 91 registered commands were activated through their real menu rows. The 89 callback/navigation results are boundary checks, Learn changes the real tutorial store, and Focus Test is intentionally unavailable. This is not a claim of 91 hardware/native/geometry end-to-end tests. Independent per-command expectations live in the test source.\n\n| Command | Expected dispatch | Disposition |\n| --- | --- | --- |\n' +
    commands
      .map(
        (c) =>
          `| ${c.id} | ${c.expected.callback ?? c.expected.url ?? c.expected.special}${c.expected.args ? `(${c.expected.args.join(', ')})` : ''}${c.expected.guard ? `; confirm: ${c.expected.guard}` : ''} | ${c.disposition} |`,
      )
      .join('\n') +
    '\n\nExact passing cases and raw report links are recorded in [JSON](control-audit-commands.json).\n',
);
console.log(JSON.stringify({ commands: commands.length, counts }));
