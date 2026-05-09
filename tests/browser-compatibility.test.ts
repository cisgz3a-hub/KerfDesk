/**
 * T3-71: proactive Web Serial browser compatibility detection.
 *
 * Run: npx tsx tests/browser-compatibility.test.ts
 */
import {
  browserLabel,
  detectBrowserCompatibility,
  markConnectBrowserGuidanceAcknowledged,
  parseBrowserFromUserAgent,
  shouldShowConnectBrowserGuidance,
  type BrowserCompatibilityInput,
} from '../src/ui/browser/BrowserCompatibility';

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ok - ${message}`);
  } else {
    failed++;
    console.error(`  not ok - ${message}`);
  }
}

function detect(input: BrowserCompatibilityInput) {
  return detectBrowserCompatibility(input);
}

console.log('\n=== T3-71 browser compatibility ===\n');

{
  assert(parseBrowserFromUserAgent('Mozilla/5.0 Firefox/121.0').family === 'firefox', 'detects Firefox');
  assert(parseBrowserFromUserAgent('Mozilla/5.0 Version/17.0 Safari/605.1.15').family === 'safari', 'detects Safari');
  assert(parseBrowserFromUserAgent('Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36').family === 'chrome', 'detects Chrome');
  assert(parseBrowserFromUserAgent('Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0').family === 'edge', 'detects Edge before Chrome');
  assert(parseBrowserFromUserAgent('Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0').family === 'opera', 'detects Opera before Chrome');
}

{
  const firefox = detect({ userAgent: 'Mozilla/5.0 Firefox/121.0', hasWebSerial: false });
  assert(!firefox.canUseUsbLaser, 'Firefox without Web Serial cannot use USB laser');
  assert(browserLabel(firefox) === 'Firefox 121.0', 'browser label includes version');

  const chrome = detect({ userAgent: 'Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36', hasWebSerial: true });
  assert(chrome.canUseUsbLaser, 'Chrome with Web Serial can use USB laser');
  assert(chrome.recommendedBrowser, 'Chrome is a recommended browser family');

  const electron = detect({ userAgent: 'LaserForge', hasWebSerial: false, isElectron: true });
  assert(electron.canUseUsbLaser && electron.family === 'electron', 'Electron path is treated as USB-capable');
}

{
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert(shouldShowConnectBrowserGuidance(storage), 'connect guidance shows before acknowledgement');
  markConnectBrowserGuidanceAcknowledged(storage);
  assert(!shouldShowConnectBrowserGuidance(storage), 'connect guidance hides after acknowledgement');
}

console.log(`\nResult: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
