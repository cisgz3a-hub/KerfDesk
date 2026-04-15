import net from 'node:net';
import process from 'node:process';
import { WebSocketServer } from 'ws';
const WS_OPEN = 1;

function parseArgs(argv) {
  let laserHost = null;
  let laserPort = 81;
  let listenPort = 8081;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      laserPort = Number.parseInt(argv[i + 1] ?? '', 10);
      i += 1;
      continue;
    }
    if (arg === '--listen') {
      listenPort = Number.parseInt(argv[i + 1] ?? '', 10);
      i += 1;
      continue;
    }
    if (!arg.startsWith('--') && !laserHost) {
      laserHost = arg;
    }
  }

  if (!laserHost) {
    throw new Error('Usage: node scripts/wifi-bridge.mjs <laser-ip> [--port <tcp-port>] [--listen <ws-port>]');
  }
  if (!Number.isFinite(laserPort) || laserPort <= 0 || laserPort > 65535) {
    throw new Error(`Invalid laser TCP port: ${laserPort}`);
  }
  if (!Number.isFinite(listenPort) || listenPort <= 0 || listenPort > 65535) {
    throw new Error(`Invalid bridge listen port: ${listenPort}`);
  }

  return { laserHost, laserPort, listenPort };
}

const { laserHost, laserPort, listenPort } = parseArgs(process.argv.slice(2));
const wss = new WebSocketServer({ port: listenPort });

console.log(`[wifi-bridge] Listening on ws://localhost:${listenPort}`);
console.log(`[wifi-bridge] Forwarding to tcp://${laserHost}:${laserPort}`);

wss.on('connection', (ws) => {
  console.log('[wifi-bridge] Browser connected');
  const tcp = net.createConnection({ host: laserHost, port: laserPort });

  tcp.on('connect', () => {
    console.log('[wifi-bridge] TCP connected to laser');
  });

  tcp.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    process.stdout.write(`[laser->browser] ${text}`);
    if (ws.readyState === WS_OPEN) {
      ws.send(text);
    }
  });

  tcp.on('error', (err) => {
    console.error(`[wifi-bridge] TCP error: ${err.message}`);
    if (ws.readyState === WS_OPEN) {
      ws.close(1011, `tcp error: ${err.message}`);
    }
  });

  tcp.on('close', () => {
    console.log('[wifi-bridge] TCP disconnected');
    if (ws.readyState === WS_OPEN) ws.close(1000, 'laser tcp closed');
  });

  ws.on('message', (data) => {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    let payload;
    if (text.startsWith('__BYTE__:')) {
      const byte = Number.parseInt(text.slice(9), 10);
      payload = Number.isFinite(byte) && byte >= 0 && byte <= 255
        ? Buffer.from([byte])
        : Buffer.from(text, 'utf8');
    } else {
      payload = Buffer.from(text, 'utf8');
    }
    process.stdout.write(`[browser->laser] ${payload.toString('utf8')}`);
    tcp.write(payload);
  });

  ws.on('close', () => {
    console.log('[wifi-bridge] Browser disconnected');
    tcp.end();
    tcp.destroy();
  });

  ws.on('error', (err) => {
    console.error(`[wifi-bridge] WS error: ${err.message}`);
    tcp.destroy();
  });
});

process.on('SIGINT', () => {
  console.log('\n[wifi-bridge] Shutting down');
  wss.close(() => process.exit(0));
});
