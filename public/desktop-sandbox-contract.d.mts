export const SANDBOX_ORIGIN: string;
export const SANDBOX_APP_ID: string;
export const SANDBOX_PRODUCT_NAME: string;
export const SANDBOX_PACKAGE_NAME: string;
export const SANDBOX_DATA_DIRECTORY: string;
export const SANDBOX_ENTITLEMENT_KEYS: Readonly<Record<string, string>>;
export const SANDBOX_RELEASE_KEYS: Readonly<Record<string, string>>;
export function hasSandboxMarker(metadata: unknown): boolean;
export function isSandboxMetadata(metadata: unknown): boolean;
