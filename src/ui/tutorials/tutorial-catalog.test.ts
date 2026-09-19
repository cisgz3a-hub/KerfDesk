import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CNC_CUT_TYPES } from '../../core/scene';
import { buildAppCommands } from '../commands/command-registry';
import { baseCtx } from '../commands/command-registry-test-helpers';
import { DESIGN_TOOLS } from '../design-studio/design-tool';
import { cncOperationTutorial, laserOperationTutorial } from '../layers/operation-tutorial';
import { COMMAND_TUTORIALS } from './command-tutorials';
import { TUTORIALS, findTutorial } from './tutorial-catalog';
import { TUTORIAL_CATEGORIES } from './tutorial-types';
import { TutorialIllustration } from './TutorialIllustration';

const UI_ROOT = resolve(process.cwd(), 'src/ui');
const TUTORIAL_ROOT = join(UI_ROOT, 'tutorials');
type Source = { readonly file: string; readonly ast: ts.SourceFile };
type Binding = { readonly source: string; readonly id: string };

describe('tutorial catalog coverage', () => {
  it('keeps stable, unique lesson IDs with complete reader metadata and meaningful steps', () => {
    const ids = TUTORIALS.map((tutorial) => tutorial.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tutorial of TUTORIALS) {
      expect(tutorial.id).toMatch(/^[a-z][a-z0-9-]*$/u);
      expect(findTutorial(tutorial.id)).toBe(tutorial);
      expect(TUTORIAL_CATEGORIES).toContain(tutorial.category);
      expect(['all', 'laser', 'cnc']).toContain(tutorial.machine);
      expect(tutorial.minutes).toBeGreaterThan(0);
      for (const field of ['title', 'summary', 'location', 'prerequisites', 'tip'] as const) {
        expect(tutorial[field].trim(), `${tutorial.id}.${field}`).not.toBe('');
      }
      expect(tutorial.keywords.length, tutorial.id).toBeGreaterThan(0);
      expect(tutorial.steps.length, tutorial.id).toBeGreaterThanOrEqual(3);
      for (const [index, step] of tutorial.steps.entries()) {
        for (const field of ['title', 'instruction', 'focus', 'result'] as const) {
          expect(step[field].trim(), `${tutorial.id} step ${index + 1}.${field}`).not.toBe('');
        }
        expect(step.instruction.length, `${tutorial.id} step ${index + 1}`).toBeGreaterThan(20);
        expect(step.result.length, `${tutorial.id} result ${index + 1}`).toBeGreaterThan(10);
      }
    }
  });

  it('maps every real command deliberately and resolves every non-null command lesson', () => {
    const actualIds = new Set(
      (['laser', 'cnc'] as const).flatMap((machineKind) =>
        buildAppCommands(baseCtx({ machineKind })).map((command) => command.id),
      ),
    );
    expect(Object.keys(COMMAND_TUTORIALS).sort()).toEqual([...actualIds].sort());
    const missing = Object.entries(COMMAND_TUTORIALS)
      .filter(([, id]) => id !== null && findTutorial(id) === undefined)
      .map(([command, id]) => ({ command, id }));
    expect(missing).toEqual([]);
  });

  it('resolves related lessons and operation-specific help targets', () => {
    const related = TUTORIALS.flatMap((tutorial) =>
      tutorial.related.map((id) => ({ source: tutorial.id, id })),
    );
    expect(unresolved(related)).toEqual([]);
    const operations = [
      ...CNC_CUT_TYPES.map(cncOperationTutorial),
      ...(['line', 'fill', 'image'] as const).map(laserOperationTutorial),
    ];
    expect(operations.filter((id) => findTutorial(id) === undefined)).toEqual([]);
  });

  it('resolves static tutorial props, direct links and dynamic help-table targets in source', () => {
    const bindings = uiSources().flatMap(sourceBindings);
    expect(bindings.length).toBeGreaterThan(0);
    expect(unresolved(bindings)).toEqual([]);
  });

  it('gives every shipped Design Studio tool a specific help-table entry', () => {
    const source = readSource(join(UI_ROOT, 'design-studio/DesignOptionsBar.tsx'));
    const table = stringTable(source.ast, 'TOOL_TUTORIALS');
    const missing = DESIGN_TOOLS.filter((tool) => !tool.planned)
      .filter(
        (tool) => !table.has(tool.kind) || findTutorial(table.get(tool.kind) ?? '') === undefined,
      )
      .map((tool) => tool.kind);
    expect(missing).toEqual([]);
  });

  it('renders every referenced visual in all stages without an unknown scene fallback', () => {
    const visuals = new Set(
      TUTORIALS.flatMap((tutorial) => [
        tutorial.visual,
        ...tutorial.steps.flatMap((step) => (step.visual === undefined ? [] : [step.visual])),
      ]),
    );
    for (const visual of visuals) {
      for (const phase of [0, 1, 2]) {
        const markup = renderToStaticMarkup(
          createElement(TutorialIllustration, {
            visual,
            phase,
            focus: `Example ${visual}`,
          }),
        );
        const svg = new DOMParser().parseFromString(markup, 'image/svg+xml');
        expect(svg.querySelector('parsererror'), `${visual} stage ${phase}`).toBeNull();
        expect(svg.documentElement.tagName).toBe('svg');
        expect(svg.documentElement.getAttribute('role')).toBe('img');
        expect(svg.querySelector('title')?.textContent).toContain(visual);
      }
    }
  });

  it('keeps lesson data, example scenes and learning state outside project/controller authority', () => {
    const isolated = uiSources().filter(
      ({ file }) =>
        dirname(file) === TUTORIAL_ROOT &&
        /(?:-tutorials|-scenes|illustration-primitives|TutorialExample|TutorialIllustration|tutorial-catalog|tutorial-store|tutorial-progress)\.(?:ts|tsx)$/u.test(
          file,
        ),
    );
    expect(isolated.length).toBeGreaterThan(0);
    const escaped = isolated.flatMap((source) =>
      runtimeImports(source.ast)
        .filter(
          (name) =>
            !['react', 'zustand'].includes(name) &&
            (!name.startsWith('./') ||
              !resolve(dirname(source.file), name).startsWith(`${TUTORIAL_ROOT}${sep}`)),
        )
        .map((name) => `${relative(UI_ROOT, source.file)} → ${name}`),
    );
    expect(escaped).toEqual([]);
  });
});

function unresolved(bindings: readonly Binding[]): readonly Binding[] {
  return bindings.filter(({ id }) => findTutorial(id) === undefined);
}

let sourceCache: readonly Source[] | undefined;
function uiSources(): readonly Source[] {
  if (sourceCache !== undefined) return sourceCache;
  const walk = (dir: string): Source[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) return walk(file);
      return /\.(ts|tsx)$/u.test(entry.name) && !entry.name.includes('.test.')
        ? [readSource(file)]
        : [];
    });
  sourceCache = walk(UI_ROOT);
  return sourceCache;
}

function readSource(file: string): Source {
  return {
    file,
    ast: ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
  };
}

function sourceBindings(source: Source): Binding[] {
  const bindings: Binding[] = [];
  const add = (node: ts.Node, ids: readonly string[]): void => {
    if (ids.length === 0) return;
    const { line } = source.ast.getLineAndCharacterOfPosition(node.getStart(source.ast));
    bindings.push(
      ...ids.map((id) => ({ source: `${relative(UI_ROOT, source.file)}:${line + 1}`, id })),
    );
  };
  const visit = (node: ts.Node): void => {
    add(node, jsxLessonTargets(node, source.ast));
    add(node, tableLessonTargets(node, source.ast));
    add(node, directLessonTargets(node));
    ts.forEachChild(node, visit);
  };
  visit(source.ast);
  return bindings;
}

function jsxLessonTargets(node: ts.Node, ast: ts.SourceFile): string[] {
  if (!ts.isJsxAttribute(node) || node.name.getText(ast) !== 'tutorialId' || !node.initializer)
    return [];
  const expression = ts.isJsxExpression(node.initializer)
    ? node.initializer.expression
    : node.initializer;
  return expression === undefined ? [] : literalOutcomes(expression);
}

function tableLessonTargets(node: ts.Node, ast: ts.SourceFile): string[] {
  if (
    !ts.isVariableDeclaration(node) ||
    !/(?:_TUTORIALS|_LESSONS)$/u.test(node.name.getText(ast)) ||
    !node.initializer ||
    !ts.isObjectLiteralExpression(node.initializer)
  )
    return [];
  return node.initializer.properties.flatMap((property) =>
    ts.isPropertyAssignment(property) ? literalOutcomes(property.initializer) : [],
  );
}

function directLessonTargets(node: ts.Node): string[] {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'openTutorial'
  )
    return [];
  const target = node.arguments[0];
  return target === undefined ? [] : literalOutcomes(target);
}

function literalOutcomes(node: ts.Node): string[] {
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isConditionalExpression(node))
    return [...literalOutcomes(node.whenTrue), ...literalOutcomes(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  )
    return [...literalOutcomes(node.left), ...literalOutcomes(node.right)];
  return [];
}

function stringTable(ast: ts.SourceFile, name: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === name &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)) {
          result.set(
            property.name.getText(ast).replaceAll(/['"]/gu, ''),
            property.initializer.text,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

function runtimeImports(ast: ts.SourceFile): readonly string[] {
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      !typeOnlyImport(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      result.push(
        node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
          ? node.arguments[0].text
          : '<computed import>',
      );
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

function typeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause?.isTypeOnly) return true;
  return (
    clause?.name === undefined &&
    clause?.namedBindings !== undefined &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.every((item) => item.isTypeOnly)
  );
}
