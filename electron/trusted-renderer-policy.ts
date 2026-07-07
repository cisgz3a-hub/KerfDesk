export const PACKAGED_RENDERER_ORIGIN = 'app://app';
export const PACKAGED_RENDERER_URL = 'app://app/index.html';

export interface RendererRuntimeInput {
  readonly devUrl?: string | undefined;
  readonly isPackaged: boolean;
}

export interface RendererRuntime {
  readonly rendererUrl: string;
  readonly trustedOrigins: ReadonlySet<string>;
}

export interface PermissionCheckPolicyInput {
  readonly permission: string;
  readonly requestingOrigin: string;
  readonly embeddingOrigin?: string;
  readonly isMainFrame?: boolean;
  readonly mediaType?: 'video' | 'audio' | 'unknown';
  readonly currentUrl: string;
}

export interface PermissionRequestPolicyInput {
  readonly permission: string;
  readonly isMainFrame: boolean;
  readonly requestingUrl: string;
  readonly mediaTypes?: ReadonlyArray<'video' | 'audio'>;
  readonly currentUrl: string;
}

export interface DevicePermissionPolicyInput {
  readonly deviceType: string;
  readonly origin: string;
}

export function makeTrustedRendererOrigins(devUrl?: string): ReadonlySet<string> {
  const origins = new Set<string>([PACKAGED_RENDERER_ORIGIN]);
  if (devUrl !== undefined && devUrl.length > 0) {
    const devOrigin = loopbackDevOriginFromUrl(devUrl);
    if (devOrigin !== null) origins.add(devOrigin);
  }
  return origins;
}

export function resolveRendererRuntime(input: RendererRuntimeInput): RendererRuntime {
  if (input.isPackaged) return packagedRendererRuntime();
  const devUrl = loopbackDevUrl(input.devUrl);
  if (devUrl === null) return packagedRendererRuntime();
  return {
    rendererUrl: devUrl.href,
    trustedOrigins: makeTrustedRendererOrigins(devUrl.href),
  };
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
    isAllowedPermissionCheck(input) &&
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
    isAllowedPermissionRequest(input) &&
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

function isAllowedPermissionCheck(input: PermissionCheckPolicyInput): boolean {
  if (input.permission === 'media') {
    return input.isMainFrame === true && input.mediaType === 'video';
  }
  return isAllowedNonMediaAppPermission(input.permission);
}

function isAllowedPermissionRequest(input: PermissionRequestPolicyInput): boolean {
  if (input.permission === 'media') {
    return input.mediaTypes?.length === 1 && input.mediaTypes[0] === 'video';
  }
  return isAllowedNonMediaAppPermission(input.permission);
}

function isAllowedNonMediaAppPermission(permission: string): boolean {
  // 'screen-wake-lock' backs useActiveJobWakeLock (ADR-117): the renderer's
  // navigator.wakeLock.request('screen') IS routed through the session
  // permission handlers, arriving as the string 'screen-wake-lock'
  // (electron/shell/common/gin_converters/content_converter.cc — verified on
  // the shipped 42-x-y branch). Chromium browsers grant it without a prompt;
  // denying it here silently disables keep-awake on the desktop app, letting
  // the OS sleep the display mid-burn while Web Serial is still streaming.
  return (
    permission === 'serial' ||
    permission === 'screen-wake-lock' ||
    permission.startsWith('fileSystem')
  );
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

function packagedRendererRuntime(): RendererRuntime {
  return {
    rendererUrl: PACKAGED_RENDERER_URL,
    trustedOrigins: new Set([PACKAGED_RENDERER_ORIGIN]),
  };
}

function loopbackDevUrl(value: string | undefined): URL | null {
  if (value === undefined || value.length === 0) return null;
  try {
    const url = new URL(value);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname)) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

function loopbackDevOriginFromUrl(value: string): string | null {
  return loopbackDevUrl(value)?.origin ?? null;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
