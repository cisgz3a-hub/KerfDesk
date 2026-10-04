import { scannedPairing } from './control-scanner-link.js';
import { createScannerReader } from './control-scanner-reader.js';
import {
  cameraAvailable,
  cameraMessage,
  requestCamera,
  stopCamera,
} from './control-scanner-camera.js';

const OPEN_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 5_000;
const SESSION_TIMEOUT_MS = 120_000;
const FRAME_INTERVAL_MS = 200;

/** Scanning fills fields only. Pairing and permissions still require the usual PC approval. */
export function bindPairingScanner() {
  const nodes = scannerNodes();
  if (!nodes) return { stop() {}, setEnabled() {} };
  const scanner = new PairingScanner(nodes);
  const stop = (message) => scanner.stop(message);
  bindLifecycle(nodes, () => scanner.start(), stop);
  scanner.updateStart();
  return { stop, setEnabled: (enabled) => scanner.setEnabled(enabled) };
}

class PairingScanner {
  generation = 0;
  stream = null;
  timer = null;
  deadline = null;
  sessionDeadline = null;
  active = false;
  enabled = true;

  constructor(nodes) {
    this.nodes = nodes;
  }
  current(run) {
    return this.active && run === this.generation && !document.hidden;
  }
  updateStart() {
    this.nodes.start.disabled =
      !this.enabled || this.active || Boolean(document.documentElement.dataset.pairingBlocked);
  }
  setEnabled(enabled) {
    this.enabled = enabled === true;
    if (!this.enabled) this.stop();
    else this.updateStart();
  }
  stop(message = '') {
    this.generation++;
    this.active = false;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    clearTimeout(this.sessionDeadline);
    stopCamera(this.stream);
    this.stream = null;
    this.nodes.video.pause();
    this.nodes.video.srcObject = null;
    this.nodes.panel.hidden = true;
    this.updateStart();
    if (message) this.nodes.pairStatus.textContent = message;
    this.nodes.status.textContent = '';
  }
  fail(run, message) {
    if (this.current(run)) this.stop(message);
  }
  async start() {
    const nodes = this.nodes;
    if (
      !this.enabled ||
      this.active ||
      document.hidden ||
      nodes.card.hidden ||
      nodes.start.disabled
    )
      return;
    if (!cameraAvailable()) {
      nodes.pairStatus.textContent =
        'Camera scanning is unavailable in this browser. Use your phone camera to open the PC’s QR code, or enter the code.';
      return;
    }
    this.stop();
    this.active = true;
    const run = this.generation;
    nodes.start.disabled = true;
    nodes.panel.hidden = false;
    nodes.status.textContent = 'Allow camera access, then point at the QR code on your PC.';
    this.deadline = setTimeout(
      () =>
        this.fail(
          run,
          'Scanning did not start. Choose Scan QR code to try again, or enter the code.',
        ),
      OPEN_TIMEOUT_MS,
    );
    await this.openCamera(run);
  }
  async openCamera(run) {
    const nodes = this.nodes;
    let acquired;
    let cameraReady = false;
    try {
      acquired = await requestCamera();
      if (!this.current(run)) return stopCamera(acquired);
      this.stream = acquired;
      bindTrackEnd(this.stream, () =>
        this.fail(run, 'The camera stopped. Scan again or enter the pairing code.'),
      );
      nodes.video.srcObject = this.stream;
      await nodes.video.play();
      if (!this.current(run)) return;
      cameraReady = true;
      const read = await createScannerReader();
      if (!this.current(run)) return;
      clearTimeout(this.deadline);
      nodes.status.textContent = 'Point at the QR code in KerfDesk’s Phone & MCP settings.';
      this.sessionDeadline = setTimeout(
        () =>
          this.fail(run, 'Scanning stopped after two minutes. Choose Scan QR code to try again.'),
        SESSION_TIMEOUT_MS,
      );
      await this.scan(run, read);
    } catch (error) {
      if (!this.current(run)) return stopCamera(acquired);
      this.fail(
        run,
        cameraReady
          ? 'QR scanning is unavailable. Use your phone camera to open the PC’s QR code, or enter the code.'
          : cameraMessage(error),
      );
    }
  }
  async scan(run, read) {
    if (!this.current(run)) return;
    this.deadline = setTimeout(
      () =>
        this.fail(run, 'The QR reader stopped responding. Scan again or enter the pairing code.'),
      READ_TIMEOUT_MS,
    );
    try {
      const values = await read(this.nodes.video);
      if (!this.current(run)) return;
      clearTimeout(this.deadline);
      if (this.usePayload(values)) return;
      this.timer = setTimeout(() => void this.scan(run, read), FRAME_INTERVAL_MS);
    } catch {
      this.fail(
        run,
        'QR scanning is unavailable. Use your phone camera to open the PC’s QR code, or enter the code.',
      );
    }
  }
  usePayload(values) {
    const nodes = this.nodes;
    for (const value of values) {
      const payload = scannedPairing(value);
      if (!payload) continue;
      this.stop(
        'Your code is filled in. Choose access, request approval, then approve this phone on the PC.',
      );
      nodes.form.elements.deviceId.value = payload.device;
      nodes.form.elements.code.value = payload.code;
      nodes.form.elements.clientLabel.focus();
      return true;
    }
    if (values.length)
      nodes.status.textContent =
        'That is not a KerfDesk pairing QR code. Scan the latest code on your PC.';
    return false;
  }
}

function scannerNodes() {
  const ids = {
    start: 'scan-pairing',
    panel: 'pair-scanner',
    video: 'pair-scanner-video',
    cancel: 'cancel-pair-scanner',
    status: 'pair-scanner-status',
    pairStatus: 'pair-status',
    form: 'pair-form',
    card: 'pair-card',
  };
  const nodes = Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [name, document.getElementById(id)]),
  );
  return Object.values(nodes).every(Boolean) ? nodes : null;
}

function bindTrackEnd(stream, stop) {
  for (const track of stream.getVideoTracks())
    track.addEventListener('ended', stop, { once: true });
}

function bindLifecycle(nodes, start, stop) {
  nodes.start.addEventListener('click', () => void start());
  nodes.cancel.addEventListener('click', () => {
    stop('Scanning cancelled. You can scan again or enter the pairing code.');
    nodes.start.focus();
  });
  nodes.form.addEventListener('submit', () => stop());
  nodes.form.addEventListener('reset', () => stop());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop('Camera stopped while this page was hidden. Scan again when ready.');
  });
  for (const event of ['pagehide', 'beforeunload', 'popstate', 'hashchange'])
    globalThis.addEventListener(event, () => stop());
  nodes.panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      stop('Scanning cancelled. You can scan again or enter the pairing code.');
      nodes.start.focus();
    }
  });
}
