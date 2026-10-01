// The main entry's runtime graph, shared by source and actual-ASAR checks.
// Parsing never executes application or third-party code.
import { isBuiltin } from 'node:module';
import { posix } from 'node:path';
import ts from 'typescript';

const MAX_MODULES = 2000;
const MAX_MODULE_BYTES = 2 * 1024 * 1024;

function caughtRequire(node) {
  let child = node;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return false;
    if (ts.isTryStatement(parent) && parent.tryBlock === child && parent.catchClause) return true;
    child = parent;
  }
  return false;
}

function moduleImports(text, filename) {
  if (Buffer.byteLength(text) > MAX_MODULE_BYTES)
    throw new Error(`Runtime module too large: ${filename}`);
  // Match tsc's removal of type-only imports, including inline type specifiers.
  if (filename.endsWith('.ts'))
    text = ts.transpileModule(text, {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  if (source.parseDiagnostics.length) throw new Error(`Cannot parse runtime module: ${filename}`);
  const imports = new Map();
  const add = (specifier, condition, caught = false) =>
    imports.set(`${condition}:${specifier}:${caught}`, { specifier, condition, caught });
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier)
      add(node.moduleSpecifier.text, 'import');
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length >= 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      add(
        node.arguments[0].text,
        node.expression.kind === ts.SyntaxKind.ImportKeyword ? 'import' : 'require',
        node.expression.kind !== ts.SyntaxKind.ImportKeyword && caughtRequire(node),
      );
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...imports.values()];
}

export function runtimePackageName(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

function relativeTarget(filename, specifier, condition, readFile, source) {
  let target = posix.normalize(posix.join(posix.dirname(filename), specifier));
  if (target.startsWith('../') || posix.isAbsolute(target))
    throw new Error(`Runtime import escapes its root: ${specifier} from ${filename}`);
  if (source && target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
  if (source || condition === 'import') return target;
  return (
    [target, target + '.js', target + '.json', `${target}/index.js`].find(
      (candidate) => readFile(candidate) !== null,
    ) ?? target
  );
}

/** Paths are archive/repository-relative POSIX paths; missing reads return null. */
export function desktopRuntimeGraph({ entry, readFile, source = false }) {
  const files = new Set();
  const packages = new Set();
  const specifiers = new Set();
  const imports = new Map();
  const queue = [entry];
  while (queue.length) {
    const filename = queue.shift();
    if (files.has(filename)) continue;
    if (files.size >= MAX_MODULES)
      throw new Error('Desktop runtime graph exceeded its module bound.');
    const text = readFile(filename);
    if (text === null) throw new Error(`Missing runtime module: ${filename}`);
    files.add(filename);
    for (const { specifier, condition, caught } of filename.endsWith('.json')
      ? []
      : moduleImports(text, filename)) {
      if (specifier === 'electron' || isBuiltin(specifier)) continue;
      if (!specifier.startsWith('.')) {
        if (specifier.includes(':') || specifier.startsWith('/'))
          throw new Error(`Unsupported runtime import: ${specifier} from ${filename}`);
        packages.add(runtimePackageName(specifier));
        specifiers.add(specifier);
        imports.set(`${filename}:${condition}:${specifier}:${caught}`, {
          specifier,
          condition,
          caught,
          fromFile: filename,
        });
        continue;
      }
      queue.push(relativeTarget(filename, specifier, condition, readFile, source));
    }
  }
  return {
    files: [...files].sort(),
    packages: [...packages].sort(),
    specifiers: [...specifiers].sort(),
    imports: [...imports.values()],
  };
}

function exportTarget(value, condition) {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = exportTarget(candidate, condition);
      if (target != null) return target;
    }
  } else if (value && typeof value === 'object') {
    for (const [name, target] of Object.entries(value))
      if (['node', condition, 'default'].includes(name)) {
        const selected = exportTarget(target, condition);
        if (selected !== undefined) return selected;
      }
  }
  return undefined;
}

function packageEntry(manifest, subpath, condition) {
  if (manifest.exports !== undefined) {
    const map = manifest.exports;
    const value =
      map && typeof map === 'object' && Object.keys(map).some((key) => key.startsWith('.'))
        ? map[subpath ? `./${subpath}` : '.']
        : subpath
          ? null
          : map;
    return exportTarget(value, condition);
  }
  return subpath || manifest.main || 'index.js';
}

function archivePackage(name, fromFile, readFile) {
  let directory = posix.dirname(fromFile);
  for (;;) {
    const root = posix.join(directory, 'node_modules', name);
    const text = readFile(`${root}/package.json`);
    if (text !== null) return { root, text };
    if (directory === '.') return null;
    directory = posix.dirname(directory);
  }
}

function optionalPackages(manifest) {
  return new Set([
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependenciesMeta ?? {}).filter(
      (name) => manifest.peerDependenciesMeta?.[name]?.optional === true,
    ),
  ]);
}

function boundedReader(readFile) {
  const cache = new Map();
  let bytes = 0;
  return (path) => {
    if (cache.has(path)) return cache.get(path);
    if (cache.size >= MAX_MODULES) throw new Error('Desktop runtime reads exceeded their bound.');
    const text = readFile(path);
    if (text !== null) {
      bytes += Buffer.byteLength(text);
      if (Buffer.byteLength(text) > MAX_MODULE_BYTES || bytes > 32 * 1024 * 1024)
        throw new Error(`Desktop runtime reads exceeded their byte bound: ${path}`);
    }
    cache.set(path, text);
    return text;
  };
}

/** Actual selected-entry graph and mandatory manifests, without executing package code. */
export function packagedRuntimeProblems({ readFile, entry = 'dist-electron/main.js' }) {
  readFile = boundedReader(readFile);
  const problems = [];
  let graph;
  try {
    graph = desktopRuntimeGraph({ entry, readFile });
  } catch (error) {
    return [error.message];
  }
  const queue = [...graph.imports];
  const seen = new Set();
  while (queue.length) {
    const { specifier, condition, fromFile } = queue.shift();
    if (seen.size >= MAX_MODULES)
      return [...problems, 'Runtime package closure exceeded its bound.'];
    const name = runtimePackageName(specifier);
    let located;
    try {
      located = archivePackage(name, fromFile, readFile);
    } catch (error) {
      return [...problems, error.message];
    }
    if (located === null) {
      problems.push(`app.asar is missing runtime package ${name}`);
      continue;
    }
    const { root, text } = located;
    const identity = `${root}:${condition}:${specifier}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    let manifest;
    try {
      manifest = JSON.parse(text);
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
        throw new Error('Invalid manifest');
    } catch {
      problems.push(`app.asar has an invalid runtime manifest for ${name}`);
      continue;
    }
    const subpath = specifier.slice(name.length).replace(/^\//, '');
    const target = packageEntry(manifest, subpath, condition);
    const path = typeof target === 'string' ? posix.normalize(posix.join(root, target)) : null;
    if (path === null || !path.startsWith(root + '/')) {
      problems.push(`app.asar has no supported ${condition} entry for ${specifier}`);
    } else {
      // Exports are exact paths; CommonJS main also permits extension/index lookup.
      const candidates =
        manifest.exports !== undefined
          ? [path]
          : [path, path + '.js', path + '.json', `${path}/index.js`];
      let selected;
      try {
        selected = candidates.find((candidate) => readFile(candidate) !== null);
      } catch (error) {
        return [...problems, error.message];
      }
      if (selected === undefined) problems.push(`app.asar is missing runtime entry ${path}`);
      else {
        try {
          const optional = optionalPackages(manifest);
          const loaded = desktopRuntimeGraph({ entry: selected, readFile });
          for (const imported of loaded.imports)
            if (
              !(
                imported.caught &&
                imported.fromFile.startsWith(root + '/') &&
                optional.has(runtimePackageName(imported.specifier))
              )
            )
              queue.push(imported);
        } catch (error) {
          problems.push(error.message);
        }
      }
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      if (!Object.hasOwn(manifest.optionalDependencies ?? {}, dependency))
        queue.push({
          specifier: dependency,
          condition: manifest.type === 'module' ? 'import' : 'require',
          fromFile: `${root}/package.json`,
        });
  }
  return [...new Set(problems)];
}
