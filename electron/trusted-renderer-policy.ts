export const PACKAGED_RENDERER_ORIGIN = 'app://app';

export interface PermissionCheckPolicyInput {
  readonly permission: string;
  readonly requestingOrigin: string;
  readonly embeddingOrigin?: string;
  readonly currentUrl: string;
}

export interface PermissionRequestPolicyInput {
  readonly permission: string;
  readonly isMainFrame: boolean;
  readonly requestingUrl: string;
  readonly currentUrl: string;
}

export interface DevicePermissionPolicyInput {
  readonly deviceType: string;
  readonly origin: string;
}

export function makeTrustedRendererOrigins(devUrl?: string): ReadonlySet<string> {
  const origins = new Set<string>([PACKAGED_RENDERER_ORIGIN]);
  if (devUrl !== undefined && devUrl.length > 0) {
    const devOrigin = rendererOriginFromUrl(devUrl);
    if (devOrigin !== null) origins.add(devOrigin);
  }
  return origins;
}

export function shouldAllowNavigation(url: string, trustedOrigins: ReadonlySet<string>): boolean {
  return isTrustedRendererUrl(url, trustedOrigins);
}

export function shouldAllowWindowOpen(_url: string, _trustedOrigins: ReadonlySet<string>): boolean {
  return false;
}

export function shouldGrantPermissionCheck(
  input: PermissionCheckPolicyInput,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  return (
    isAllowedAppPermission(input.permission) &&
    isTrustedRendererUrl(input.requestingOrigin, trustedOrigins) &&
    isTrustedRendererUrl(input.currentUrl, trustedOrigins) &&
    isTrustedOptionalEmbeddingOrigin(input.embeddingOrigin, trustedOrigins)
  );
}

export function shouldGrantPermissionRequest(
  input: PermissionRequestPolicyInput,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  return (
    isAllowedAppPermission(input.permission) &&
    input.isMainFrame &&
    isTrustedRendererUrl(input.requestingUrl, trustedOrigins) &&
    isTrustedRendererUrl(input.currentUrl, trustedOrigins)
  );
}

export function shouldGrantDevicePermission(
  input: DevicePermissionPolicyInput,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  return input.deviceType === 'serial' && isTrustedRendererUrl(input.origin, trustedOrigins);
}

function isAllowedAppPermission(permission: string): boolean {
  return permission === 'serial' || permission.startsWith('fileSystem');
}

function isTrustedOptionalEmbeddingOrigin(
  embeddingOrigin: string | undefined,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  return embeddingOrigin === undefined || isTrustedRendererUrl(embeddingOrigin, trustedOrigins);
}

function isTrustedRendererUrl(url: string, trustedOrigins: ReadonlySet<string>): boolean {
  const origin = rendererOriginFromUrl(url);
  return origin !== null && trustedOrigins.has(origin);
}

function rendererOriginFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'app:' && url.host === 'app') return PACKAGED_RENDERER_ORIGIN;
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
    return null;
  } catch {
    return null;
  }
}
