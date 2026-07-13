/* global Blob, document, EventTarget, File, MediaStream, navigator, queueMicrotask, ReadableStream, setTimeout, TextDecoder, TextEncoder, window, WritableStream */

const BASIC_PROJECT = '__KERFDESK_E2E_PROJECT_FIXTURE__';

const state = {
  events: [],
  openFiles: [{ name: 'project-basic.lf2', text: BASIC_PROJECT }],
  savedFiles: {},
  autoAcknowledge: true,
};

function record(kind, detail = {}) {
  state.events.push({ kind, ...detail });
}

function installSerial() {
  let readController = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const port = new EventTarget();
  port.readable = null;
  port.writable = null;
  port.open = async ({ baudRate }) => {
    record('serial-open', { baudRate });
    port.readable = new ReadableStream({
      start(controller) {
        readController = controller;
      },
      cancel() {
        readController = null;
      },
    });
    port.writable = new WritableStream({
      write(chunk) {
        const text = decoder.decode(chunk);
        record('serial-write', { text });
        respondToSerialWrite(text, emitLine);
      },
    });
    queueMicrotask(() => {
      emitLine("Grbl 1.1h ['$' for help]");
      emitIdle();
    });
  };
  port.close = async () => {
    record('serial-close');
    readController = null;
    port.readable = null;
    port.writable = null;
  };
  port.forget = async () => record('serial-forget');

  function emitLine(line) {
    readController?.enqueue(encoder.encode(`${line}\n`));
  }
  function emitIdle() {
    emitLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  }

  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: {
      getPorts: async () => [],
      requestPort: async () => {
        record('serial-request-port');
        return port;
      },
    },
  });
  return {
    emitLine,
    acknowledge(count) {
      for (let index = 0; index < count; index += 1) emitLine('ok');
      emitIdle();
    },
  };
}

function respondToSerialWrite(text, emitLine) {
  if (text === '?') {
    emitLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
    return;
  }
  if (text.includes('$$')) {
    emitLine('$30=1000');
    emitLine('$31=0');
    emitLine('$32=1');
  }
  const acknowledgements = [...text].filter((character) => character === '\n').length;
  if (!state.autoAcknowledge && acknowledgements > 0) {
    record('serial-acks-held', { count: acknowledgements });
    return;
  }
  setTimeout(() => {
    for (let index = 0; index < acknowledgements; index += 1) emitLine('ok');
    emitLine('<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>');
  }, 0);
}

function installFilePickers() {
  window.showOpenFilePicker = async (options) => {
    record('picker-open', { multiple: options?.multiple === true });
    return state.openFiles.map(fileHandle);
  };
  window.showSaveFilePicker = async (options) => {
    const name = options?.suggestedName ?? 'saved-output.txt';
    record('picker-save', { name });
    return saveHandle(name);
  };
}

function fileHandle(file) {
  return {
    kind: 'file',
    name: file.name,
    getFile: async () =>
      file.kind === 'png-fixture'
        ? generatedPngFile(file)
        : new File([file.text ?? ''], file.name, { type: textFileType(file.name) }),
  };
}

async function generatedPngFile(file) {
  const width = file.width ?? 64;
  const height = file.height ?? 64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#000000';
  context.fillRect(width / 4, height / 4, width / 2, height / 2);
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (value) => (value === null ? reject(new Error('PNG encode failed')) : resolve(value)),
      'image/png',
    ),
  );
  return new File([blob], file.name, { type: 'image/png' });
}

function textFileType(name) {
  if (/\.svg$/i.test(name)) return 'image/svg+xml';
  if (/\.csv$/i.test(name)) return 'text/csv';
  if (/\.(clb|lbrn2?)$/i.test(name)) return 'application/xml';
  return 'application/json';
}

function saveHandle(name) {
  return {
    kind: 'file',
    name,
    createWritable: async () => {
      let pending = '';
      return {
        write: async (data) => {
          pending = data instanceof Blob ? await data.text() : String(data);
        },
        close: async () => {
          state.savedFiles[name] = pending;
          record('file-saved', { name, bytes: pending.length });
        },
        abort: async () => record('file-save-abort', { name }),
      };
    },
  };
}

function installCamera() {
  const track = { stop: () => record('camera-track-stop') };
  const stream = new MediaStream();
  Object.defineProperty(stream, 'getTracks', { value: () => [track] });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      enumerateDevices: async () => [
        { deviceId: 'e2e-camera', groupId: 'e2e', kind: 'videoinput', label: 'E2E Camera' },
      ],
      getUserMedia: async (constraints) => {
        record('camera-open', { constraints });
        return stream;
      },
    },
  });
}

const serial = installSerial();
installFilePickers();
installCamera();
window.__KERFDESK_E2E__ = {
  events: state.events,
  savedFiles: state.savedFiles,
  emitSerialLine: serial.emitLine,
  acknowledgeSerial: serial.acknowledge,
  setAutoAcknowledge: (enabled) => {
    state.autoAcknowledge = enabled;
    record('serial-auto-ack', { enabled });
  },
  setOpenFiles: (files) => {
    state.openFiles = files;
  },
};
