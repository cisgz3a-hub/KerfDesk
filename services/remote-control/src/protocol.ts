import { z } from 'zod';
import {
  mcpInputSchemas,
  MCP_WRITE_COMMANDS,
  type KerfDeskMcpCommand,
} from '../../../electron/mcp/input-schemas.js';

export const PUBLIC_ORIGIN = 'https://kerfdesk-phone-control.cisgz3a.workers.dev';
export const RESOURCE = `${PUBLIC_ORIGIN}/mcp`;
export const MAX_BYTES = 256 * 1024;
export const MAX_METADATA_BYTES = 4096;
export const PAIR_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const ACCESS_TTL_SECONDS = 30 * 60;
export const GRANT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const COMMAND_TIMEOUT_MS = 20_000;
export const COOKIE_NAME = '__Host-kerfdesk_control';
export const OAUTH_READ = 'kerfdesk:read';
export const OAUTH_EDIT = 'kerfdesk:edit';
export const WRITE_COMMANDS = MCP_WRITE_COMMANDS;
export const uuid = z.uuid();
export const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const scopesSchema = z
  .array(z.enum(['read', 'edit']))
  .min(1)
  .max(2)
  .refine((value) => value.includes('read') && new Set(value).size === value.length);
export type RemoteScope = z.output<typeof scopesSchema>;
export const registerSchema = z.strictObject({
  v: z.literal(1),
  deviceId: uuid,
  label: z.string().min(1).max(128),
  ownerSecret: secret,
});
export const claimSchema = z.strictObject({
  v: z.literal(1),
  deviceId: uuid,
  code: z.string().regex(/^[A-Za-z0-9-]{12}$/),
  clientLabel: z
    .string()
    .min(1)
    .max(64)
    .refine((value) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 66),
  requestedScopes: scopesSchema,
});
export const commandSchema = z.strictObject({
  name: z.enum(Object.keys(mcpInputSchemas) as [KerfDeskMcpCommand, ...KerfDeskMcpCommand[]]),
  args: z.record(z.string(), z.unknown()),
});
export const grantSchema = z.strictObject({ deviceId: uuid, clientId: uuid, leaseId: uuid });
export type GrantProps = z.output<typeof grantSchema>;
export type McpReservation = { key: string; id: string };
// A fresh encrypted grant identity separates OAuth apps/approvals sharing one paired browser.
export const oauthGrantSchema = grantSchema.extend({ mcpGrantId: uuid });
export type OAuthGrantProps = z.output<typeof oauthGrantSchema>;
export type SessionIdentity = { deviceId: string; clientId: string; digest: string };
export type RemoteClient = {
  id: string;
  label: string;
  scopes: RemoteScope;
  createdAt: number;
};
export type StoredClient = RemoteClient & {
  status: 'pending' | 'approved';
  leaseId: string;
  sessionDigest: string;
  sessionExpiresAt: number;
  claimExpiresAt: number;
  leaseExpiresAt: number;
};

export function normalizedScopes(value: readonly string[]): RemoteScope | null {
  const result = scopesSchema.safeParse(value);
  return result.success ? result.data : null;
}
export function oauthScopes(scopes: readonly string[]): RemoteScope | null {
  if (!scopes.includes(OAUTH_READ)) return null;
  return scopes.includes(OAUTH_EDIT) ? ['read', 'edit'] : ['read'];
}
export function parseCommand(value: unknown) {
  const command = commandSchema.safeParse(value);
  if (!command.success) return null;
  const args = mcpInputSchemas[command.data.name].safeParse(command.data.args);
  return args.success ? { name: command.data.name, args: args.data } : null;
}
