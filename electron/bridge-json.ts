import type { ServerResponse } from 'node:http';

/** Write a JSON body with no-store caching — shared by every bridge route. */
export function writeJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
