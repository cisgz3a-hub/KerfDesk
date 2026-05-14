import assert from 'node:assert/strict';
import {
  buildSupportBundle,
  findLicenseKeyLeaks,
  type SupportBundleInputs,
} from '../src/diagnostics/SupportBundle';
import {
  buildSupportBundleZip,
  saveSupportBundleZip,
  supportBundleZipFileName,
} from '../src/diagnostics/SupportBundleExport';

console.log('\n=== Support bundle ZIP export ===\n');

function makeInputs(): SupportBundleInputs {
  return {
    appInfo: {
      version: '1.2.3',
      buildChannel: 'dev',
      electron: '31.0.0',
      chromium: '126.0.0',
      node: '20.0.0',
    },
    systemInfo: {
      platform: 'win32',
      arch: 'x64',
      locale: 'en-US',
      screen: { width: 1920, height: 1080 },
    },
    correlationIds: {
      sessionId: 'session_det_000001',
      projectId: 'project_det_000001',
      compileId: null,
      preflightId: null,
      frameId: null,
      jobId: 'job_det_000001',
      supportBundleId: 'bundle_det_000001',
    },
    jobLogs: [{
      id: 'job-1',
      projectName: 'Customer sign',
      entries: [{ type: 'error', message: 'Stopped after status timeout' }],
    }],
    errors: [{
      message: 'license key 12345678-1234-1234-1234-123456789abc must redact',
    }],
    machineProfile: { brand: 'xTool', model: 'Falcon A1 Pro' },
    storage: { totalBytes: 1234 },
  };
}

function hasAscii(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, 'utf8'));
}

const bundle = buildSupportBundle({
  inputs: makeInputs(),
  bundleId: 'bundle_det_000001',
  generatedAt: '2026-05-14T00:00:00.000Z',
});

assert.deepEqual(findLicenseKeyLeaks(bundle), [], 'fixture bundle starts redacted');

async function main(): Promise<void> {
{
  const zip = buildSupportBundleZip(bundle);
  assert(zip[0] === 0x50 && zip[1] === 0x4b, 'zip starts with PK signature');
  assert(hasAscii(zip, 'manifest.json'), 'zip contains manifest filename');
  assert(hasAscii(zip, 'recent-job-logs.json'), 'zip contains job logs filename');
  assert(hasAscii(zip, 'Stopped after status timeout'), 'zip stores redacted JSON content');
  assert(!hasAscii(zip, '12345678-1234-1234-1234-123456789abc'), 'zip does not leak license keys');
}

{
  const filename = supportBundleZipFileName(bundle);
  assert(filename === 'laserforge-support-bundle_det_000001.zip',
    `stable support-bundle filename expected, got ${filename}`);
}

{
  const calls: Array<{ defaultName: string; base64Content: string }> = [];
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {
    electronAPI: {
      saveBinaryFile: async (defaultName: string, base64Content: string) => {
        calls.push({ defaultName, base64Content });
        return true;
      },
    },
  };

  try {
    const result = await saveSupportBundleZip(bundle);
    assert(result.ok === true, 'saveSupportBundleZip reports success');
    assert(result.method === 'electron-dialog', 'Electron binary save dialog is preferred');
    assert(calls.length === 1, 'Electron saveBinaryFile called once');
    assert(calls[0].defaultName === 'laserforge-support-bundle_det_000001.zip',
      'Electron save receives support bundle filename');
    const saved = Buffer.from(calls[0].base64Content, 'base64');
    assert(saved[0] === 0x50 && saved[1] === 0x4b, 'Electron save payload is ZIP base64');
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
}

console.log('Support bundle ZIP export tests passed.');
}

void main();
