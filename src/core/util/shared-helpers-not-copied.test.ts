// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

// Code quality audit C1 (C2-P3-1) found the same three-line helpers written out
// in up to sixty files each, and some copies had drifted apart. About 480
// copies now import one shared function. This test keeps it that way: it fails
// when a shipped file declares a private function whose body is, token for
// token, the body of a function one of the modules below already exports.
const SHARED_MODULES = [
  'src/core/util/is-record.ts',
  'src/core/util/error-message.ts',
  'src/core/util/finite.ts',
  'src/core/util/text.ts',
  'src/core/util/rounding.ts',
  'src/core/util/number-format.ts',
  'src/core/util/unique.ts',
  'src/core/math/clamp.ts',
  'src/core/math/wrap.ts',
  'src/core/geometry/point-math.ts',
  'src/core/geometry/box-math.ts',
  'src/core/geometry/point-in-polygon.ts',
  'src/core/geometry/vec3.ts',
  'src/ui/common/sleep.ts',
];

// Folders that may import nothing outside themselves, by their own test. A
// helper they need is a deliberate copy.
const ISOLATED_FOLDERS = [
  // user-macro-dependency-boundary.test.ts: only `react` and `./` imports.
  'src/ui/laser/console/user-macros/',
];

const NOT_SHIPPED =
  /\.(test|spec)\.|__fixtures__|test-support|test-fixture|-testing\.|[\\/]testing[\\/]|\.d\.ts$/;

type FunctionLike = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;
type Helper = { readonly name: string; readonly exported: boolean; readonly fn: FunctionLike };

function shippedFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) found.push(...shippedFiles(path));
    else if (/\.tsx?$/.test(entry.name) && !NOT_SHIPPED.test(path)) found.push(path);
  }
  return found;
}

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

/** Top-level functions of a file: declarations and `const name = (…) => …`. */
function helpers(source: ts.SourceFile): Helper[] {
  const found: Helper[] = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body && statement.name) {
      const exported = (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0;
      found.push({ name: statement.name.text, exported, fn: statement });
    } else if (ts.isVariableStatement(statement)) {
      const helper = constHelper(statement);
      if (helper !== null) found.push(helper);
    }
  }
  return found;
}

/** `const name = (…) => …` as a helper, or null for any other statement. */
function constHelper(statement: ts.VariableStatement): Helper | null {
  const [declaration, ...rest] = statement.declarationList.declarations;
  const initializer = declaration?.initializer;
  if (declaration === undefined || rest.length > 0 || initializer === undefined) return null;
  if (!ts.isIdentifier(declaration.name)) return null;
  if (!ts.isArrowFunction(initializer) && !ts.isFunctionExpression(initializer)) return null;
  const exported =
    statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  return { name: declaration.name.text, exported, fn: initializer };
}

/** True when the identifier names a member, a type or a label, not a variable. */
function isMemberName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    ts.isTypeReferenceNode(parent)
  );
}

function tokens(text: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const out: string[] = [];
  for (let t = scanner.scan(); t !== ts.SyntaxKind.EndOfFileToken; t = scanner.scan()) {
    out.push(scanner.getTokenText());
  }
  return out.join(' ');
}

/**
 * The body with comments and spacing dropped and parameters renamed by
 * position, so `clamp(n, lo, hi)` and `clamp(value, min, max)` compare equal.
 * Types are left out: a copy that only changes an annotation is still a copy.
 */
function normalBody(source: ts.SourceFile, fn: FunctionLike): string | null {
  const body = fn.body;
  if (body === undefined) return null;
  const names = new Map<string, string>();
  for (const [index, parameter] of fn.parameters.entries()) {
    if (!ts.isIdentifier(parameter.name)) return null;
    names.set(parameter.name.text, `$${index}`);
  }
  const edits: Array<readonly [number, number, string]> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !isMemberName(node)) {
      const renamed = names.get(node.text);
      if (renamed !== undefined) edits.push([node.getStart(), node.getEnd(), renamed]);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  const base = body.getStart();
  let text = source.text.slice(base, body.getEnd());
  for (const [start, end, renamed] of edits.sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start - base) + renamed + text.slice(end - base);
  }
  if (!ts.isBlock(body)) text = `{ return ${text}; }`;
  return `${fn.parameters.length}:${tokens(text)}`;
}

it(
  'no shipped file re-declares a helper the shared modules already export',
  { timeout: 300_000 },
  () => {
    const shared = new Map<string, string>();
    for (const file of SHARED_MODULES) {
      const source = parse(file);
      for (const helper of helpers(source)) {
        const body = helper.exported ? normalBody(source, helper.fn) : null;
        if (body !== null) shared.set(body, `${helper.name} from ${file}`);
      }
    }
    expect(shared.size).toBeGreaterThan(50);

    const copies: string[] = [];
    for (const file of shippedFiles('src')) {
      if (SHARED_MODULES.includes(file)) continue;
      if (ISOLATED_FOLDERS.some((folder) => file.startsWith(folder))) continue;
      const source = parse(file);
      for (const helper of helpers(source)) {
        const body = normalBody(source, helper.fn);
        const original = body === null ? undefined : shared.get(body);
        if (original !== undefined) copies.push(`${file}: ${helper.name} is ${original}`);
      }
    }
    expect(copies, 'import the shared function instead of repeating it').toEqual([]);
  },
);
