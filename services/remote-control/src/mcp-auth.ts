import type { KerfDeskMcpCommand } from '../../../electron/mcp/input-schemas.js';
import type { KerfDeskMcpToolMetadata } from '../../../electron/mcp/server.js';
import { mcpToolInfo } from '../../../electron/mcp/tool-info.js';
import { PUBLIC_ORIGIN, OAUTH_READ, OAUTH_EDIT, WRITE_COMMANDS } from './protocol.js';

/** The SDK's public _meta hook carries OpenAI's documented auth-policy mirror. */
export const remoteToolMetadata: KerfDeskMcpToolMetadata = Object.fromEntries(
  (Object.keys(mcpToolInfo) as KerfDeskMcpCommand[]).map((command) => [
    command,
    {
      securitySchemes: [
        {
          type: 'oauth2',
          scopes: WRITE_COMMANDS.has(command) ? [OAUTH_READ, OAUTH_EDIT] : [OAUTH_READ],
        },
      ],
    },
  ]),
);

/** Fixed values only: submitted arguments, tokens and device identities never enter a challenge. */
export function mcpAuthChallenge(error: 'invalid_token' | 'insufficient_scope'): string {
  const scopes = error === 'insufficient_scope' ? [OAUTH_READ, OAUTH_EDIT] : [OAUTH_READ];
  const description =
    error === 'insufficient_scope'
      ? 'Editing requires approval on this computer.'
      : 'This computer approval is unavailable.';
  return `Bearer error="${error}", error_description="${description}", scope="${scopes.join(' ')}", resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp"`;
}
