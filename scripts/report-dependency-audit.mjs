import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export function classifyDependencyAudit(fullAudit, runtimeAudit, exits = {}) {
  const full = validatedAdvisories(fullAudit, 'full audit', exits.fullExit);
  const runtime = validatedAdvisories(runtimeAudit, 'runtime audit', exits.runtimeExit);
  const runtimeIds = new Set(Object.keys(runtime));
  // The registry can change between these two requests. A runtime finding
  // remains evidence even when it was absent from the earlier full snapshot.
  const advisories = Object.entries({ ...full, ...runtime })
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
    evidenceStatus: 'valid',
    runtimeCount: advisories.filter((entry) => entry.reachability === 'runtime-reachable').length,
    releaseBuildOnlyCount: advisories.filter((entry) => entry.reachability === 'release-build-only')
      .length,
    buildTestOnlyCount: advisories.filter((entry) => entry.reachability === 'build-test-only')
      .length,
    advisories,
  };
}

function validatedAdvisories(audit, label, exitValue) {
  if (!isRecord(audit) || audit.error !== undefined || !isRecord(audit.advisories)) {
    const detail = isRecord(audit?.error) ? audit.error.message : undefined;
    throw new Error(
      `${label} did not provide valid advisory evidence${detail ? `: ${detail}` : '.'}`,
    );
  }
  if (exitValue !== undefined) {
    const exitCode = Number(exitValue);
    if (
      ![0, 1, '0', '1'].includes(exitValue) ||
      (exitCode === 1 && Object.keys(audit.advisories).length === 0)
    ) {
      throw new Error(`${label} scanner exit ${exitValue} does not establish an audit result.`);
    }
  }
  for (const [id, advisory] of Object.entries(audit.advisories)) {
    if (
      !isRecord(advisory) ||
      typeof advisory.module_name !== 'string' ||
      !Array.isArray(advisory.findings) ||
      advisory.findings.some(
        (finding) =>
          !isRecord(finding) ||
          !Array.isArray(finding.paths) ||
          finding.paths.some((entry) => typeof entry !== 'string'),
      )
    ) {
      throw new Error(`${label} contains malformed advisory ${id}.`);
    }
  }
  return audit.advisories;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function dependencyAuditMarkdown(report) {
  if (report.evidenceStatus === 'invalid') {
    return [
      '# Dependency audit evidence unavailable',
      '',
      'Dependency advisory status could not be established. This is not a clean audit.',
      '',
      report.error,
      '',
      'Retain the existing advisory issue and retry the scanner.',
      '',
    ].join('\n');
  }
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
  let report;
  try {
    const fullAudit = JSON.parse(fs.readFileSync(fullFile, 'utf8'));
    const runtimeAudit = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
    report = classifyDependencyAudit(fullAudit, runtimeAudit, {
      fullExit: argument('full-exit'),
      runtimeExit: argument('runtime-exit'),
    });
  } catch (error) {
    report = {
      generatedAt: new Date().toISOString(),
      evidenceStatus: 'invalid',
      runtimeCount: null,
      releaseBuildOnlyCount: null,
      buildTestOnlyCount: null,
      advisories: [],
      error: error.message,
    };
    process.exitCode = 1;
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'report.md'), dependencyAuditMarkdown(report));
  const githubOutput = argument('github-output');
  if (githubOutput !== undefined) {
    fs.appendFileSync(
      githubOutput,
      report.evidenceStatus === 'valid'
        ? `evidence_valid=true\nruntime_count=${report.runtimeCount}\ntotal_count=${report.advisories.length}\n`
        : 'evidence_valid=false\nruntime_count=unknown\ntotal_count=unknown\n',
    );
  }
  console.log(
    report.evidenceStatus === 'valid'
      ? `Dependency audit classified: ${report.runtimeCount} runtime, ${report.releaseBuildOnlyCount} release-build-only, ${report.buildTestOnlyCount} build/test-only.`
      : `Dependency audit evidence failed: ${report.error}`,
  );
}
