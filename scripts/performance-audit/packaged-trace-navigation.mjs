/* global document, location */
// Attach only to an explicitly launched, isolated free/Preview package.
// Does not launch, close, import into, or change the profile/security settings of the app.
import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import asar from '@electron/asar';
import {
  verifyObservationOwner,
  assertSameObservationOwner,
} from './packaged-observation-owner.mjs';
import { chromium } from '@playwright/test';
import {
  NATIVE_CANVAS_OBSERVER_SOURCE,
  NATIVE_CANVAS_SNAPSHOT_SOURCE,
} from './packaged-canvas-observer.mjs';

export function freePackageEvidence(metadata) {
  if (!metadata || typeof metadata !== 'object' || typeof metadata.version !== 'string')
    throw new Error('Invalid packaged metadata');
  // Matches licensing-config.ts: even malformed commercial opt-in must fail closed.
  if (Object.hasOwn(metadata, 'kerfdeskCommercialLicense'))
    throw new Error('Canvas CDP qualification refuses all commercial licensing metadata');
  return {
    version: metadata.version,
    licensingChannel: 'free',
    desktopReleaseChannel: metadata.kerfdeskDesktopReleaseChannel ?? null,
    packageMetadataSha256: createHash('sha256').update(JSON.stringify(metadata)).digest('hex'),
  };
}

export function validateEndpoint(value) {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    !endpoint.port ||
    endpoint.username ||
    endpoint.password ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Expected an explicit http://127.0.0.1:<port> CDP endpoint');
  return endpoint.href;
}

export function panPlan(rect) {
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width < 160 ||
    rect.height < 120
  )
    throw new Error('Workspace canvas is missing or too small for bounded panning');
  const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return { start, dx: Math.min(60, rect.width / 6), dy: Math.min(24, rect.height / 6), steps: 12 };
}

export async function verifyBrowserProcess(browser, expectedPid) {
  const pid = Number(expectedPid);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Expected PID must be positive');
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const browsers = processInfo.filter((item) => item.type === 'browser');
    if (browsers.length !== 1 || browsers[0].id !== pid)
      throw new Error('CDP endpoint does not belong to the expected packaged process');
    return { expectedPid: pid, browserPid: browsers[0].id, matched: true };
  } finally {
    await session.detach();
  }
}

async function runtimeEvidence(page) {
  return page.evaluate(async () => {
    if (location.href !== 'app://app/index.html') throw new Error('Not the packaged renderer');
    const response = await fetch('app://app/api/licensing/status', {
      headers: { 'X-KerfDesk-Licensing': '1' },
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Local licensing status could not be read');
    const licensing = await response.json();
    if (licensing.channel !== 'free') throw new Error('Only a free package may use this probe');
    return {
      url: location.href,
      userAgent: navigator.userAgent,
      visibility: document.visibilityState,
      licensing: { channel: licensing.channel, edition: licensing.edition },
      buildBadge:
        document.querySelector('[aria-label="Build version"]')?.getAttribute('title') ?? null,
    };
  });
}

async function snapshot(page) {
  return page.evaluate(NATIVE_CANVAS_SNAPSHOT_SOURCE);
}

export async function runPan(page) {
  const rect = await page.evaluate(() => {
    const visibleDialog = [
      ...document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
    ].some((item) => item.getBoundingClientRect().width > 0);
    if (visibleDialog) throw new Error('Close the modal before the bounded pan probe');
    if (document.visibilityState !== 'visible') throw new Error('The renderer is not visible');
    const canvas = document.querySelector('canvas[aria-label$=" workspace"]');
    if (!canvas) throw new Error('Workspace canvas missing');
    const bounds = canvas.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  const plan = panPlan(rect);
  const before = await snapshot(page);
  await page.mouse.move(plan.start.x, plan.start.y);
  let pressed = false;
  try {
    await page.mouse.down({ button: 'middle' });
    pressed = true;
    for (let step = 1; step <= plan.steps; step += 1) {
      await page.mouse.move(
        plan.start.x + (plan.dx * step) / plan.steps,
        plan.start.y + (plan.dy * step) / plan.steps,
      );
      await delay(16);
    }
  } finally {
    if (pressed) await page.mouse.up({ button: 'middle' });
  }
  await delay(150);
  return {
    inputSource: 'CDP-injected middle-button drag',
    plan,
    before,
    after: await snapshot(page),
  };
}

export async function runProbe(options) {
  const expectedPid = Number(options['expected-pid']);
  if (!Number.isSafeInteger(expectedPid) || expectedPid <= 0)
    throw new Error('--expected-pid is required and must be a positive integer');
  const owner = await verifyObservationOwner(options);
  const endpoint = validateEndpoint(options.endpoint);
  if (!isAbsolute(options.executable) || !isAbsolute(options.output))
    throw new Error('Executable and output paths must be absolute');
  const executable = resolve(options.executable);
  if (!(await stat(executable)).isFile()) throw new Error('Expected a packaged executable file');
  const archive = join(dirname(executable), 'resources', 'app.asar');
  const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const packaged = freePackageEvidence(metadata);
  const receipt = {
    mode: options.mode,
    startedAt: new Date().toISOString(),
    endpoint,
    executable,
    archive,
    packaged,
    qualification:
      'diagnostic only; OS input, saved geometry and native qualification are recorded separately',
  };
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 15_000, noDefaults: true });
  try {
    receipt.processIdentity = await verifyBrowserProcess(browser, expectedPid);
    const matches = browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => page.url() === 'app://app/index.html');
    if (matches.length !== 1) throw new Error('Expected exactly one packaged app renderer');
    const page = matches[0];
    page.setDefaultTimeout(15_000);
    receipt.runtime = await runtimeEvidence(page);
    assertSameObservationOwner(owner, await verifyObservationOwner(options));
    receipt.observationOwner = owner;
    if (options.mode === 'install') {
      receipt.installation = await page.evaluate(NATIVE_CANVAS_OBSERVER_SOURCE);
      receipt.renderer = await snapshot(page);
    } else if (options.mode === 'reset') {
      receipt.renderer = await page.evaluate('window.__kerfdeskNativeCanvasObservation.reset()');
    } else if (options.mode === 'pan') {
      receipt.pan = await runPan(page);
    } else {
      receipt.renderer = await snapshot(page);
    }
    assertSameObservationOwner(owner, await verifyObservationOwner(options));
    const name = new Date().toISOString().replaceAll(':', '-') + '-' + options.mode;
    await mkdir(options.output, { recursive: true });
    if (options.mode === 'pan' || options.mode === 'snapshot') {
      receipt.screenshot = join(options.output, name + '.png');
      await page.screenshot({ path: receipt.screenshot, timeout: 15_000 });
    }
    receipt.finishedAt = new Date().toISOString();
    const result = join(options.output, name + '.json');
    await writeFile(result, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    return { result, ...receipt };
  } finally {
    // connectOverCDP creates no owned contexts. Browser.close disconnects this
    // connection; it does not send Browser.close to the user's existing app.
    await browser.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'snapshot' },
      endpoint: { type: 'string' },
      executable: { type: 'string' },
      output: { type: 'string' },
      'expected-pid': { type: 'string' },
      'expected-profile': { type: 'string' },
      'isolation-root': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node scripts/performance-audit/packaged-trace-navigation.mjs --mode=install|snapshot|reset|pan --endpoint=http://127.0.0.1:PORT --executable=ABSOLUTE_EXE --output=ABSOLUTE_DIRECTORY --expected-pid=PID --expected-profile=ABSOLUTE_PROFILE --isolation-root=ABSOLUTE_EVIDENCE_ROOT',
    );
    return;
  }
  if (
    !['install', 'snapshot', 'reset', 'pan'].includes(values.mode) ||
    !values.endpoint ||
    !values.executable ||
    !values.output ||
    !values['expected-pid'] ||
    !values['expected-profile'] ||
    !values['isolation-root']
  )
    throw new Error(
      'Specify --mode, --endpoint, --executable, --output, --expected-pid, --expected-profile and --isolation-root; use --help',
    );
  const result = await runProbe(values);
  console.log(
    JSON.stringify({ result: result.result, mode: result.mode, runtime: result.runtime }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
