import type { App } from '@modelcontextprotocol/ext-apps';
import { RemoteError, type RemoteTransport } from './transport';

/**
 * Calls KerfDesk tools through the host's existing authenticated MCP connection. The panel has
 * no network, cookies or credentials of its own (empty CSP allowlists, ADR-582).
 */
export class McpTransport implements RemoteTransport {
  readonly kind = 'mcp' as const;
  constructor(private readonly app: App) {}

  async call<T = Record<string, unknown>>(
    command: string,
    args: Record<string, unknown> = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    let result: Awaited<ReturnType<App['callServerTool']>>;
    try {
      result = await this.app.callServerTool(
        { name: command, arguments: args },
        options.signal === undefined
          ? { timeout: 30_000 }
          : { signal: options.signal, timeout: 30_000 },
      );
    } catch {
      throw new RemoteError('offline', 'The chat app couldn’t reach KerfDesk. Try again.', true);
    }
    const structured = result.structuredContent as Record<string, unknown> | undefined;
    if (result.isError === true) {
      const error = structured?.error as { code?: string } | undefined;
      throw new RemoteError(error?.code ?? 'failed');
    }
    return (structured ?? {}) as T;
  }

  /** MCP hosts have no push channel; the controller long-polls `wait_for_change` instead. */
  subscribe(): () => void {
    return () => undefined;
  }
  socketOpen(): boolean {
    return false;
  }
  heartbeat(): void {}
  releaseHolds(): void {}
}
