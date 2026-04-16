#!/usr/bin/env node
/**
 * Wainlux WiFi Bridge — dual-channel GRBL transport.
 *
 * The Wainlux X1 uses two channels:
 *   Port 81 (WebSocket): receives GRBL status reports + responses (binary frames)
 *   Port 80 (HTTP GET):  sends G-code commands via /command?commandText=...
 *
 * This bridge unifies both into a single WebSocket that LaserForge connects to.
 *
 * Usage:
 *   node scripts/wainlux-bridge.mjs [laser-ip] [--ws-port <port>]
 *   node scripts/wainlux-bridge.mjs 192.168.0.1
 *   node scripts/wainlux-bridge.mjs 192.168.0.1 --ws-port 8765
 *
 * Then in LaserForge: Connect via WiFi → localhost:8765
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

// ─── PARSE ARGS ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const laserIp = args[0] || '192.168.0.1';
let wsPort = 8765;

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--ws-port' && args[i + 1]) {
    wsPort = parseInt(args[i + 1], 10);
    i++;
  }
}

// ─── HTTP COMMAND SENDER ────────────────────────────────────────

function sendCommand(cmd) {
  const encoded = encodeURIComponent(cmd);
  const url = `/command?commandText=${encoded}&PAGEID=0`;

  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: laserIp,
      port: 80,
      path: url,
      headers: {
        'Host': `${laserIp}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'User-Agent': 'LaserForge/1.0',
      },
      timeout: 5000,
    }, (res) => {
      res.resume(); // drain response
      resolve();
    });
    req.on('error', (err) => {
      console.error(`  ✗ HTTP error: ${err.message}`);
      reject(err);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('HTTP timeout'));
    });
  });
}

// ─── BRIDGE ─────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: wsPort });

console.log(`\n⚡ LaserForge Wainlux Bridge`);
console.log(`   Browser WebSocket:  ws://localhost:${wsPort}`);
console.log(`   Laser WebSocket:    ws://${laserIp}:81`);
console.log(`   Laser HTTP:         http://${laserIp}:80/command`);
console.log(`   Waiting for browser connection...\n`);

wss.on('connection', (browserWs) => {
  const RX_BUFFER_SIZE = 128;
  const sentLineLengths = []; // FIFO: byte count of each line in GRBL's buffer
  let bufferUsed = 0;
  const commandQueue = []; // lines waiting for room

  console.log('🔗 Browser connected');

  function resetStreamState() {
    sentLineLengths.length = 0;
    bufferUsed = 0;
    commandQueue.length = 0;
  }

  function drainQueue() {
    while (
      commandQueue.length > 0 &&
      bufferUsed + commandQueue[0].byteCount < RX_BUFFER_SIZE
    ) {
      const { line: trimmed, byteCount } = commandQueue.shift();
      void sendCommand(trimmed).catch((err) => {
        console.error(`  ✗ Failed to send: ${err.message}`);
      });
      sentLineLengths.push(byteCount);
      bufferUsed += byteCount;
      console.log(
        '[STREAM] sent: ' +
          trimmed.substring(0, 30) +
          ' | buffer: ' +
          bufferUsed +
          '/128, queued: ' +
          commandQueue.length
      );
    }
  }

  function sendGcodeWithFlowControl(line) {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    const byteCount = trimmed.length + 1; // +1 for newline GRBL counts
    if (bufferUsed + byteCount < RX_BUFFER_SIZE) {
      void sendCommand(trimmed).catch((err) => {
        console.error(`  ✗ Failed to send: ${err.message}`);
      });
      sentLineLengths.push(byteCount);
      bufferUsed += byteCount;
    } else {
      commandQueue.push({ line: trimmed, byteCount });
    }
    console.log(
      '[STREAM] sent: ' +
        trimmed.substring(0, 30) +
        ' | buffer: ' +
        bufferUsed +
        '/128, queued: ' +
        commandQueue.length
    );
  }

  // Connect to laser's WebSocket for receiving GRBL data
  const laserWs = new WebSocket(`ws://${laserIp}:81/`, {
    protocolVersion: 13,
  });

  let laserConnected = false;
  let lineBuffer = '';

  laserWs.on('open', () => {
    laserConnected = true;
    console.log(`🔗 Connected to laser WebSocket (ws://${laserIp}:81)`);

    // Send synthetic GRBL welcome to browser immediately.
    // The real welcome data arrives too early (before GrblController's onData is ready).
    // This guaranteed-late message makes GrblController detect the firmware.
    setTimeout(() => {
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send("Grbl 1.1h ['$' for help]");
        console.log('  → Sent synthetic GRBL welcome to browser');
      }
    }, 500);
  });

  laserWs.on('message', (data, isBinary) => {
    const text = data.toString('utf-8');

    if (!isBinary) {
      // Text frames: CURRENT_ID, ACTIVE_ID, PING — CutLabX management
      const trimmed = text.trim();
      if (trimmed === 'PING:0') {
        // Silently ignore keepalive
        return;
      }
      if (trimmed.startsWith('CURRENT_ID:') || trimmed.startsWith('ACTIVE_ID:')) {
        console.log(`  ← [mgmt] ${trimmed}`);
        return;
      }
      // Forward any other text frames
      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(trimmed);
      }
      return;
    }

    // Binary frames: GRBL data — split by newlines and forward
    lineBuffer += text;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.replace(/\r$/, '').trim();
      if (trimmed.length === 0) continue;

      if (trimmed === 'ok' || trimmed.startsWith('error')) {
        if (sentLineLengths.length > 0) {
          bufferUsed -= sentLineLengths.shift();
        }
        drainQueue();
      }

      if (browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(trimmed);
      }

      // Log concisely
      if (trimmed.startsWith('<')) {
        // Status report — log briefly
        const state = trimmed.substring(1, trimmed.indexOf('|'));
        process.stdout.write(`  ← [${state}] `);
        if (trimmed.includes('MPos:')) {
          const mpos = trimmed.match(/MPos:([^|>]+)/);
          if (mpos) process.stdout.write(mpos[1]);
        }
        console.log('');
      } else if (trimmed === 'ok') {
        // Don't log every ok
      } else {
        console.log(`  ← ${trimmed}`);
      }
    }
  });

  laserWs.on('error', (err) => {
    console.error(`❌ Laser WebSocket error: ${err.message}`);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(`__ERROR__:${err.message}`);
      browserWs.close();
    }
  });

  laserWs.on('close', () => {
    console.log('🔌 Laser WebSocket closed');
    resetStreamState();
    laserConnected = false;
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.close();
    }
  });

  // Browser → Laser: send G-code via HTTP GET (GRBL character-counting for G-code only)
  browserWs.on('message', async (data) => {
    const msg = data.toString().trim();
    if (!laserConnected) return;

    try {
      if (msg.startsWith('__BYTE__:')) {
        // Realtime commands — bypass GRBL RX buffer accounting
        const byte = parseInt(msg.substring(9), 10);
        if (byte === 0x3F) {
          await sendCommand('?');
        } else if (byte === 0x18) {
          await sendCommand('\x18');
          console.log('  → [soft reset]');
        } else if (byte === 0x21) {
          await sendCommand('!');
          console.log('  → [feed hold]');
        } else if (byte === 0x7E) {
          await sendCommand('~');
          console.log('  → [resume]');
        } else {
          await sendCommand(String.fromCharCode(byte));
          console.log(`  → [byte 0x${byte.toString(16)}]`);
        }
      } else {
        sendGcodeWithFlowControl(msg);
      }
    } catch (err) {
      console.error(`  ✗ Failed to send: ${err.message}`);
    }
  });

  browserWs.on('close', () => {
    console.log('🔌 Browser disconnected');
    resetStreamState();
    if (laserConnected) {
      laserWs.close();
    }
  });

  browserWs.on('error', (err) => {
    console.error(`❌ Browser WebSocket error: ${err.message}`);
    if (laserConnected) {
      laserWs.close();
    }
  });
});

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${wsPort} is already in use. Kill the other bridge or use --ws-port <port>`);
  } else {
    console.error(`❌ WebSocket server error: ${err.message}`);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down bridge...');
  wss.close();
  process.exit(0);
});
