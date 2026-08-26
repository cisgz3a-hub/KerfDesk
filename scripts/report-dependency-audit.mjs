import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function classifyDependencyAudit(fullAudit, runtimeAudit) {
  const runtimeIds = new Set(Object.keys(runtimeAudit.advisories ?? {}));
  const advisories = Object.entries(fullAudit.advisories ?? {})
    .map(([id, advisory]) => {
      const moduleName = advisory.module_name ?? 'unknown';
      const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? []);
      // Electron is intentionally a devDependency because the renderer does not
      // import it. Its binary is nevertheless the packaged desktop runtime, so
      // a --prod-only classification would hide Electron runtime advisories.
      const packagedRuntime = moduleName === 'electron' && paths.includes('.>electron');
      const releaseBuild = paths.some((dependencyPath) =>
        /^(?:\.>(?:electron|electron-builder|wrangler)>|\.>@electron\/asar>)/u.test(dependencyPath),
      );
      const reachability =
        runtimeIds.has(id) || packagedRuntime
          ? 'runtime-reachable'
          : releaseBuild
            ? 'release-build-only'
            : 'build-test-only';
      return {
        id,
        module: moduleName,
        title: advisory.title ?? 'Untitled advisory',
        severity: advisory.severity ?? 'unknown',
        url: advisory.url ?? '',
        paths,
        reachability,
      };
    })
    .sort(
      (a, b) => a.reachability.localeCompare(b.reachability) || a.module.localeCompare(b.module),
    );
  return {
    generatedAt: new Date().toISOString(),
    runtimeCount: advisories.filter((entry) => entry.reachability === 'runtime-reachable').length,
    releaseBuildOnlyCount: advisories.filter((entry) => entry.reachability === 'release-build-only')
      .length,
    buildTestOnlyCount: advisories.filter((entry) => entry.reachability === 'build-test-only')
      .length,
    advisories,
  };
}

export function dependencyAuditMarkdown(report) {
  const lines = [
    '# Dependency audit report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `- Runtime-reachable dependency advisories: **${report.runtimeCount}**`,
    `- Release-build-only dependency advisories: **${report.releaseBuildOnlyCount}**`,
    `- Build/test-only dependency advisories: **${report.buildTestOnlyCount}**`,
    '',
    'Runtime classification combines a separate `pnpm audit --prod` graph with the packaged',
    'Electron host, which is a devDependency but is still product runtime. Release-build-only and',
    'build/test-only scanner hits are tracked supply-chain maintenance, not product-runtime defects.',
    '',
  ];
  for (const reachability of ['runtime-reachable', 'release-build-only', 'build-test-only']) {
    lines.push(`## ${reachability}`, '');
    const entries = report.advisories.filter((entry) => entry.reachability === reachability);
    if (entries.length === 0) {
      lines.push('None.', '');
      continue;
    }
    for (const entry of entries) {
      const link = entry.url === '' ? entry.title : `[${entry.title}](${entry.url})`;
      lines.push(`- **${entry.severity} — ${entry.module}**: ${link}`);
      for (const dependencyPath of entry.paths) lines.push(`  - \`${dependencyPath}\``);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const invoked = process.argv[1] === fileURLToPath(import.meta.url);
if (invoked) {
  const fullFile = argument('full') ?? 'artifacts/dependency-audit/full.json';
  const runtimeFile = argument('runtime') ?? 'artifacts/dependency-audit/runtime.json';
  const outputDir = argument('output') ?? 'artifacts/dependency-audit';
  const fullAudit = JSON.parse(fs.readFileSync(fullFile, 'utf8'));
  const runtimeAudit = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
  const report = classifyDependencyAudit(fullAudit, runtimeAudit);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'report.md'), dependencyAuditMarkdown(report));
  const githubOutput = argument('github-output');
  if (githubOutput !== undefined) {
    fs.appendFileSync(
      githubOutput,
      `runtime_count=${report.runtimeCount}\ntotal_count=${report.advisories.length}\n`,
    );
  }
  console.log(
    `Dependency audit classified: ${report.runtimeCount} runtime, ${report.releaseBuildOnlyCount} release-build-only, ${report.buildTestOnlyCount} build/test-only.`,
  );
}
