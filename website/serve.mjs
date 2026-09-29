// Local preview server for the built website (dev only; production is static
// hosting). Mirrors the host closely enough to catch mistakes early: pretty
// URLs, 404.html, and the generated _headers — including the CSP — applied.
//
//   node website/serve.mjs [--port 5190] [--dir website/dist]

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEBSITE_DIR = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function arg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
}

// Parses the Cloudflare `_headers` format: a path glob line, then indented
// "Name: value" lines.
function parseHeaders(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ glob: line.trim(), headers: {} });
    else {
      const colon = line.indexOf(':');
      rules.at(-1).headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return rules;
}

function headersFor(rules, path) {
  const out = {};
  for (const rule of rules) {
    const prefix = rule.glob.replace(/\*$/, '');
    if (path.startsWith(prefix)) Object.assign(out, rule.headers);
  }
  return out;
}

function resolveFile(root, urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const candidate = resolve(root, clean);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  const index = join(candidate, 'index.html');
  return existsSync(index) ? index : null;
}

const root = resolve(arg('--dir', join(WEBSITE_DIR, 'dist')));
const port = Number(arg('--port', '5190'));
const rules = parseHeaders(readFileSync(join(root, '_headers'), 'utf8'));

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!path.endsWith('/') && !extname(path) && resolveFile(root, path)) {
    res.writeHead(308, { Location: `${path}/` });
    res.end();
    return;
  }
  const file = resolveFile(root, path);
  const status = file ? 200 : 404;
  const body = readFileSync(file ?? join(root, '404.html'));
  const type = TYPES[extname(file ?? '.html')] ?? 'application/octet-stream';
  const headers = headersFor(rules, path);
  delete headers['Strict-Transport-Security'];
  headers['Content-Security-Policy'] = headers['Content-Security-Policy']?.replace(
    '; upgrade-insecure-requests',
    '',
  );
  res.writeHead(status, { ...headers, 'Content-Type': type });
  res.end(body);
}).listen(port, () => {
  console.log(`KerfDesk website preview on http://localhost:${port}/`);
});
