import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOTS = ['src', 'electron'];
const DOC_PATH = path.join('docs', 'AUDIT-EXPORTED-SYMBOL-INVENTORY.md');
const IGNORED_DIRS = new Set(['.git', 'dist', 'dist-electron', 'node_modules']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(fullPath, out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(fullPath);
    }
  }
  return out;
}

function normalized(file) {
  return file.replace(/\\/g, '/');
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function collectBindingNames(name, names) {
  if (ts.isIdentifier(name)) {
    names.push(name.text);
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) collectBindingNames(element.name, names);
    }
  }
}

function declarationName(node, fallback = 'default') {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (node.name && ts.isStringLiteral(node.name)) return node.name.text;
  return fallback;
}

function add(records, sourceFile, file, node, kind, name) {
  records.push({ file: normalized(file), line: lineOf(sourceFile, node), kind, name });
}

function collectExportsFromFile(file) {
  const sourceText = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const records = [];

  function visit(node) {
    const exported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const defaulted = hasModifier(node, ts.SyntaxKind.DefaultKeyword);

    if (ts.isFunctionDeclaration(node) && exported) {
      add(records, sourceFile, file, node, defaulted ? 'default-function' : 'function', declarationName(node));
    } else if (ts.isClassDeclaration(node) && exported) {
      add(records, sourceFile, file, node, defaulted ? 'default-class' : 'class', declarationName(node));
    } else if (ts.isInterfaceDeclaration(node) && exported) {
      add(records, sourceFile, file, node, 'interface', declarationName(node, 'anonymous-interface'));
    } else if (ts.isTypeAliasDeclaration(node) && exported) {
      add(records, sourceFile, file, node, 'type', declarationName(node, 'anonymous-type'));
    } else if (ts.isEnumDeclaration(node) && exported) {
      add(records, sourceFile, file, node, 'enum', declarationName(node, 'anonymous-enum'));
    } else if (ts.isModuleDeclaration(node) && exported) {
      add(records, sourceFile, file, node, 'namespace', declarationName(node, 'anonymous-namespace'));
    } else if (ts.isVariableStatement(node) && exported) {
      for (const declaration of node.declarationList.declarations) {
        const names = [];
        collectBindingNames(declaration.name, names);
        for (const name of names) add(records, sourceFile, file, declaration, 'const', name);
      }
    } else if (ts.isExportDeclaration(node)) {
      const moduleSuffix = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? ` from ${node.moduleSpecifier.text}` : '';
      if (!node.exportClause) {
        add(records, sourceFile, file, node, 'export-star', `*${moduleSuffix}`);
      } else if (ts.isNamespaceExport(node.exportClause)) {
        add(records, sourceFile, file, node, 'namespace-export', `${node.exportClause.name.text}${moduleSuffix}`);
      } else if (ts.isNamedExports(node.exportClause)) {
        for (const specifier of node.exportClause.elements) {
          const exportedName = specifier.name.text;
          const localName = specifier.propertyName?.text;
          const name =
            localName && localName !== exportedName
              ? `${localName} as ${exportedName}${moduleSuffix}`
              : `${exportedName}${moduleSuffix}`;
          add(records, sourceFile, file, specifier, 're-export', name);
        }
      }
    } else if (ts.isExportAssignment(node)) {
      add(records, sourceFile, file, node, node.isExportEquals ? 'export-equals' : 'default-expression', node.isExportEquals ? 'export =' : 'default');
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return records;
}

function collectAllExports() {
  return ROOTS.flatMap((root) => walk(root).flatMap(collectExportsFromFile)).sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind),
  );
}

function domainFor(file) {
  if (file.startsWith('src/controllers/') || file.startsWith('src/app/MachineService') || file.includes('ExecutionCoordinator')) {
    return 'machine-control';
  }
  if (file.startsWith('src/core/output/') || file.startsWith('src/core/job/') || file.startsWith('src/core/preflight/') || file.startsWith('src/core/plan/')) {
    return 'compile-output';
  }
  if (file.startsWith('src/io/') || file.startsWith('electron/')) return 'file-ipc-boundary';
  if (file.startsWith('src/ui/')) return 'ui-operator-surface';
  if (file.startsWith('src/entitlements/')) return 'entitlement-security';
  if (file.startsWith('src/core/')) return 'core-domain';
  return 'supporting-runtime';
}

function testHints(file) {
  const testsDir = 'tests';
  if (!fs.existsSync(testsDir)) return [];
  const stem = path.basename(file).replace(/\.(tsx|ts)$/, '').toLowerCase();
  return walk(testsDir)
    .map(normalized)
    .filter((testFile) => testFile.toLowerCase().includes(stem))
    .slice(0, 3);
}

function cell(value) {
  return String(value).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ');
}

function auditCells(record) {
  const domain = domainFor(record.file);
  const surfaceOnly = ['interface', 'type', 're-export', 'export-star', 'namespace-export'].includes(record.kind);
  const hints = testHints(record.file);
  return {
    inputs: surfaceOnly ? 'N/A - contract/export surface' : 'inventory row - verify at implementation review',
    failure: surfaceOnly ? 'N/A' : 'inventory row - enumerate on deep review',
    effects: surfaceOnly ? 'N/A' : 'inventory row - classify pure vs effectful on deep review',
    resources: surfaceOnly
      ? 'N/A'
      : domain === 'machine-control' || domain === 'file-ipc-boundary'
        ? 'needs lifecycle review'
        : 'N/A unless implementation acquires resources',
    reentrant: surfaceOnly ? 'N/A' : domain === 'machine-control' || domain === 'ui-operator-surface' ? 'needs concurrency review' : 'review if stateful',
    deterministic: surfaceOnly ? 'N/A' : domain === 'compile-output' || domain === 'core-domain' ? 'determinism-sensitive' : 'not compile-output unless noted',
    unit: hints.length > 0 ? hints.join('<br>') : 'not auto-matched by filename',
    integration: domain === 'machine-control' || domain === 'compile-output' || domain === 'file-ipc-boundary' ? 'requires production-path evidence' : 'not required by inventory',
    notes: `${domain}; T1-238 inventory row generated 2026-05-13`,
  };
}

function renderMarkdown(records) {
  const byFile = new Map();
  const byDomain = new Map();
  for (const record of records) {
    if (!byFile.has(record.file)) byFile.set(record.file, []);
    byFile.get(record.file).push(record);
    const domain = domainFor(record.file);
    byDomain.set(domain, (byDomain.get(domain) ?? 0) + 1);
  }

  const lines = [
    '# Exported Symbol Audit Inventory',
    '',
    '**Ticket:** T1-238',
    '**Audit source:** `docs/AUDIT-2026-05-12.md` F-016 and `docs/AUDIT.md` Phase 4 no-skip requirement.',
    '**Scope:** every exported symbol discovered in `src/` and `electron/` TypeScript/TSX files.',
    '',
    'This is the durable no-skip inventory layer for the Phase 4 function-level audit. It intentionally avoids claiming that every symbol has had a full manual control-flow/data-flow/taint/trust-boundary review; instead it guarantees that every live export has a row, a domain bucket, and a follow-up review posture. The companion check fails when new exports are added without refreshing this inventory.',
    '',
    '## Summary',
    '',
    `- Export rows: ${records.length}`,
    `- Files with exports: ${byFile.size}`,
    '- Generated deterministically by `node scripts/exported-symbol-inventory.mjs --write`.',
    '',
    '| Domain | Export rows |',
    '|---|---:|',
  ];

  for (const [domain, count] of [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${cell(domain)} | ${count} |`);
  }

  lines.push('', '## Checklist', '');
  for (const [file, fileRecords] of byFile.entries()) {
    lines.push(`### File: \`${file}\``, '', `**Exports inventoried:** ${fileRecords.length}`, '');
    lines.push('| Line | Export | Kind | Inputs validated | Failure modes | Side effects docced | Resource lifecycle | Re-entrant / concurrency | Determinism | Unit test evidence | Integration evidence | Notes |');
    lines.push('|---:|---|---|---|---|---|---|---|---|---|---|---|');
    for (const record of fileRecords) {
      const audit = auditCells(record);
      lines.push(`| ${record.line} | \`${cell(record.name)}\` | ${cell(record.kind)} | ${cell(audit.inputs)} | ${cell(audit.failure)} | ${cell(audit.effects)} | ${cell(audit.resources)} | ${cell(audit.reentrant)} | ${cell(audit.deterministic)} | ${cell(audit.unit)} | ${cell(audit.integration)} | ${cell(audit.notes)} |`);
    }
    lines.push('', '**Findings count for this file:** inventory-only; see dated audit ledgers for findings.', '');
  }
  return `${lines.join('\n')}\n`;
}

function checkInventory(records) {
  if (!fs.existsSync(DOC_PATH)) {
    throw new Error(`${DOC_PATH} is missing. Run node scripts/exported-symbol-inventory.mjs --write.`);
  }
  const expected = renderMarkdown(records);
  const actual = fs.readFileSync(DOC_PATH, 'utf8');
  if (actual !== expected) {
    throw new Error(`${DOC_PATH} is stale. Run node scripts/exported-symbol-inventory.mjs --write.`);
  }
}

const args = new Set(process.argv.slice(2));
const records = collectAllExports();

if (args.has('--json')) {
  process.stdout.write(JSON.stringify(records, null, 2));
} else if (args.has('--write')) {
  fs.writeFileSync(DOC_PATH, renderMarkdown(records));
  console.log(`Wrote ${DOC_PATH} with ${records.length} export rows.`);
} else if (args.has('--check')) {
  checkInventory(records);
  console.log(`${DOC_PATH} is current with ${records.length} export rows.`);
} else {
  process.stdout.write(renderMarkdown(records));
}
