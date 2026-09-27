// Node entry of the headless trace command (ADR-477). scripts/trace-cli.mjs
// loads it through Vite's SSR module loader, so it runs straight from the source
// tree; the trace itself is src/ui/trace-cli/run-trace-cli.ts.

import { readFile, writeFile } from 'node:fs/promises';
import { runTraceCli, type TraceCliIo } from '../src/ui/trace-cli/run-trace-cli';

async function readStdin(): Promise<Uint8Array> {
  if (process.stdin.isTTY === true) {
    throw new Error('No input: give an image file, or pipe one into standard input.');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, 'utf8', (error) => (error == null ? resolve() : reject(error)));
  });
}

const io: TraceCliIo = {
  readInput: async (path) => (path === null ? readStdin() : new Uint8Array(await readFile(path))),
  writeOutput: (path, text) => (path === null ? writeStdout(text) : writeFile(path, text, 'utf8')),
  writeError: (text) => process.stderr.write(text),
};

export async function main(argv: readonly string[]): Promise<number> {
  return runTraceCli(argv, io);
}
