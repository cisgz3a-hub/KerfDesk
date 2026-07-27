// Generates the bundled project library: one true-millimetre SVG per project
// plus a metadata catalog, both checked in so normal builds and tests need no
// generation step. Precedent: scripts/generate-cnc-stroke-fonts.mjs.
//
// Geometry lives in .svg and metadata in .json deliberately: the file-size
// policy (scripts/check-file-size-policy.mjs) only counts source extensions, so
// the library can grow to hundreds of projects while the TypeScript that reads
// it stays one small module.
//
// Run: node scripts/generate-project-library.mjs

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ALL_PROJECTS } from './project-library/projects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'src/ui/library/assets/projects');
const CATALOG = path.join(OUT_DIR, 'catalog.json');
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIFFICULTIES = new Set(['beginner', 'intermediate', 'advanced']);
const MACHINE_MODES = new Set(['laser', 'cnc']);

function fail(message) {
  console.error(`project-library: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function requireFields(project) {
  const required = ['id', 'title', 'category', 'subcategory', 'summary', 'svg', 'spec'];
  for (const key of required) {
    if (project[key] === undefined || project[key] === '') fail(`${project.id}: missing ${key}`);
  }
  const lists = ['collections', 'machineModes', 'operations', 'tags', 'steps'];
  for (const key of lists) {
    if (!Array.isArray(project[key]) || project[key].length === 0) {
      fail(`${project.id}: ${key} must be a non-empty array`);
    }
  }
}

function requireSpec(project) {
  const spec = project.spec;
  const numbers = ['stockThicknessMm', 'partCount', 'estimatedMinutes'];
  for (const key of numbers) {
    if (typeof spec[key] !== 'number' || !Number.isFinite(spec[key])) {
      fail(`${project.id}: spec.${key} must be a finite number`);
    }
  }
  if (!DIFFICULTIES.has(spec.difficulty)) fail(`${project.id}: bad difficulty ${spec.difficulty}`);
  if (!Array.isArray(spec.materials) || spec.materials.length === 0) {
    fail(`${project.id}: spec.materials must be a non-empty array`);
  }
  if (!Array.isArray(spec.bits) || spec.bits.length === 0) {
    fail(`${project.id}: spec.bits must be a non-empty array`);
  }
  for (const key of ['sheetSizeMm', 'finishedSizeMm']) {
    const size = spec[key];
    if (typeof size?.widthMm !== 'number' || typeof size?.heightMm !== 'number') {
      fail(`${project.id}: spec.${key} needs widthMm and heightMm`);
    }
  }
}

/**
 * Checks the emitted document against what the shipped SVG importer needs: a
 * millimetre-true document with at least one stroked path. A project whose SVG
 * imports as nothing is worse than absent, so this is a hard error.
 */
function requireSvg(project) {
  const svg = project.svg;
  if (!svg.startsWith('<svg ') || !svg.endsWith('</svg>')) fail(`${project.id}: malformed SVG`);
  if (!/width="[\d.]+mm" height="[\d.]+mm"/.test(svg)) fail(`${project.id}: SVG is not mm-sized`);
  if (!svg.includes('stroke=')) fail(`${project.id}: SVG has no stroked geometry to import`);
  if (svg.includes('NaN') || svg.includes('Infinity')) fail(`${project.id}: SVG has bad numbers`);
  const declared = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm"/);
  const sheet = project.spec.sheetSizeMm;
  const near = (a, b) => Math.abs(a - b) < 0.01;
  if (!near(Number(declared[1]), sheet.widthMm) || !near(Number(declared[2]), sheet.heightMm)) {
    fail(`${project.id}: spec.sheetSizeMm disagrees with the emitted SVG size`);
  }
}

function validate(projects) {
  const seen = new Set();
  for (const project of projects) {
    if (!ID_PATTERN.test(project.id ?? '')) fail(`invalid id: ${project.id}`);
    if (seen.has(project.id)) fail(`duplicate id: ${project.id}`);
    seen.add(project.id);
    requireFields(project);
    requireSpec(project);
    requireSvg(project);
    for (const mode of project.machineModes) {
      if (!MACHINE_MODES.has(mode)) fail(`${project.id}: unknown machine mode ${mode}`);
    }
  }
}

function catalogEntry(project) {
  return {
    id: project.id,
    title: project.title,
    category: project.category,
    subcategory: project.subcategory,
    collections: project.collections,
    machineModes: project.machineModes,
    operations: project.operations,
    tags: project.tags,
    summary: project.summary,
    spec: project.spec,
    steps: project.steps,
  };
}

function pruneStale(keep) {
  for (const name of readdirSync(OUT_DIR)) {
    if (!name.endsWith('.svg')) continue;
    if (!keep.has(name)) rmSync(path.join(OUT_DIR, name));
  }
}

function main() {
  const projects = ALL_PROJECTS;
  validate(projects);
  mkdirSync(OUT_DIR, { recursive: true });
  const written = new Set();
  for (const project of projects) {
    const file = `${project.id}.svg`;
    writeFileSync(path.join(OUT_DIR, file), `${project.svg}\n`, 'utf8');
    written.add(file);
  }
  pruneStale(written);
  const catalog = {
    note: 'Generated by scripts/generate-project-library.mjs — do not edit by hand.',
    projects: projects.map(catalogEntry).sort((a, b) => a.id.localeCompare(b.id)),
  };
  writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  const bytes = projects.reduce((sum, p) => sum + p.svg.length, 0);
  console.log(
    `project-library: wrote ${projects.length} projects ` +
      `(${(bytes / 1024).toFixed(1)} KiB of SVG) to ${path.relative(ROOT, OUT_DIR)}`,
  );
}

main();
