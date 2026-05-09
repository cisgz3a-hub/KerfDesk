/**
 * T3-65: parse Falcon network targets.
 *
 * Production users enter a plain IP/hostname and keep the firmware default
 * ports. Tests can pass host:port so fake local servers use ephemeral ports
 * instead of fighting real devices or other test processes.
 */
export interface FalconNetworkTarget {
  readonly host: string;
  readonly port: number;
  readonly hostHeader: string;
}

function hostHeaderFor(host: string, port: number): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}

export function resolveFalconTarget(input: string, defaultPort: number): FalconNetworkTarget {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { host: '127.0.0.1', port: defaultPort, hostHeader: `127.0.0.1:${defaultPort}` };
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const host = url.hostname;
    const port = url.port ? Number(url.port) : defaultPort;
    return { host, port, hostHeader: hostHeaderFor(host, port) };
  }

  const bracketMatch = trimmed.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketMatch) {
    const host = bracketMatch[1];
    const port = bracketMatch[2] ? Number(bracketMatch[2]) : defaultPort;
    return { host, port, hostHeader: hostHeaderFor(host, port) };
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const [host, portText] = trimmed.split(':');
    const port = Number(portText);
    if (host && Number.isInteger(port) && port > 0 && port <= 65535) {
      return { host, port, hostHeader: hostHeaderFor(host, port) };
    }
  }

  return { host: trimmed, port: defaultPort, hostHeader: hostHeaderFor(trimmed, defaultPort) };
}
