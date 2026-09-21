import fs from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import path from 'node:path';
import ts from 'typescript';

const base = 'docs/audits/2026-09-21-interface';
const areas = ['laser', 'machine', 'calibration'];
const inventory = JSON.parse(fs.readFileSync(`${base}/buttons.json`, 'utf8'));
const controls = inventory.controls.filter((control) => areas.includes(control.area));
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(file);
    else if (/\.test\.tsx?$/.test(file)) files.push(file);
  }
}
for (const area of areas) walk(`src/ui/${area}`);
const cases = [];
for (const file of files) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node, ancestors) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(source);
      const title = node.arguments[0];
      const body = node.arguments.find(
        (arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg),
      );
      if (
        /^(it|test|describe)(\.|\(|$)/.test(expression) &&
        title &&
        ts.isStringLiteralLike(title) &&
        body
      ) {
        const fullName = [...ancestors, title.text].join(' > ');
        if (expression.startsWith('describe')) {
          ts.forEachChild(body, (child) => visit(child, [...ancestors, title.text]));
        } else {
          cases.push({
            file,
            title: title.text,
            fullName,
            body: body.getText(source),
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          });
        }
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, ancestors));
  }
  visit(source, []);
}
const cache = path.join(process.env.TEMP ?? '.', 'kerfdesk-machine-audit-cases.json');
fs.writeFileSync(cache, JSON.stringify(cases, null, 2));
console.log(
  JSON.stringify({ controls: controls.length, files: files.length, tests: cases.length, cache }),
);

if (process.argv[2] === 'titles') {
  const pattern = new RegExp(process.argv[3] ?? '.*', 'i');
  for (const item of cases.filter((item) => pattern.test(item.file)))
    console.log(`${item.file}:${item.line} | ${item.fullName}`);
}
if (process.argv[2] === 'cases') {
  const pattern = new RegExp(process.argv[3] ?? '.*', 'i');
  const title = new RegExp(process.argv[4] ?? '.*', 'i');
  for (const item of cases.filter((item) => pattern.test(item.file) && title.test(item.fullName)))
    console.log(`${item.file}:${item.line} | ${item.fullName}\n${item.body}\n`);
}
