import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('command hover explanations', () => {
  it('gives every raw JSX button and summary control a title tooltip', () => {
    const missing = uiSourceFiles().flatMap(commandControlsMissingTitle);

    expect(missing).toEqual([]);
  });
});

function commandControlsMissingTitle(file: string): ReadonlyArray<string> {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const missing: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(ast);
      if ((tagName === 'button' || tagName === 'summary') && !hasJsxAttribute(node, 'title')) {
        const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        missing.push(`${relative(process.cwd(), file)}:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(ast);
  return missing;
}

function hasJsxAttribute(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): boolean {
  return node.attributes.properties.some(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function uiSourceFiles(): ReadonlyArray<string> {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) files.push(full);
    }
  };
  walk(join(process.cwd(), 'src', 'ui'));
  return files;
}
