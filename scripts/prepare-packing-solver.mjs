// Reproducible no-eval glue adaptation; native WASM and algorithm are unchanged.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const original = fs.readFileSync('scripts/vendor/packingsolver-49bf6c7.upstream.js', 'utf8');
const digest = createHash('sha256').update(original).digest('hex');
if (digest !== '27a920820ebd0f537466843f83cd026946ece227e92f4ba34c9967cc4c6fd5a3') {
  throw new Error('PackingSolver upstream input differs from reviewed artifact');
}
const source = ts.createSourceFile(
  'packingsolver.js',
  original,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const replacement = fs
  .readFileSync('scripts/vendor/packingsolver-no-eval-invoker.js.txt', 'utf8')
  .replace(/\r\n?/g, '\n');
const edits = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node)) {
    if (node.name?.text === 'craftInvokerFunction')
      edits.push({ start: node.getStart(source), end: node.end, text: replacement });
    if (node.name?.text === 'createJsInvoker')
      edits.push({ start: node.getStart(source), end: node.end, text: '' });
  }
  ts.forEachChild(node, visit);
}
visit(source);
if (edits.length !== 2) throw new Error('Expected exactly two reviewed Embind functions');
let output = original;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
}
if (/new Function\b|\beval\s*\(/.test(output))
  throw new Error('Dynamic JavaScript execution remains');
const target = 'public/vendor/packingsolver/49bf6c7/packingsolver.js';
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== output)
    throw new Error('Regenerate the reviewed no-eval loader');
} else fs.writeFileSync(target, output);
console.log(
  `PackingSolver no-eval loader verified: ${createHash('sha256').update(output).digest('hex')}`,
);
