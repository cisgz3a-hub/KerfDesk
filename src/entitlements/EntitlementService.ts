import type { EntitlementState, EntitlementTier, LicenseStatus, ProFeature } from './types';
import { PRO_FEATURES } from './types';
import { buildStatusDetail } from './LicenseStatus';
import {
  type EntitlementTokenPayload,
  type EntitlementVerifier,
  verifyEntitlementToken,
  verifyFailureMessage,
} from './SignedEntitlementToken';
import { parseTesterCode, verifyTesterCode } from './testerKey';
import { getStorage } from '../core/storage/storage';

const STORAGE_KEY = 'laserforge_license';
const PRO_FLAG_KEY = 'laserforge_pro';
const LICENSE_CACHE_KEY = 'laserforge_license_cache';
const LICENSE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const GUMROAD_PRODUCT_ID = 'Fpj-vH0Hklzn3O2j5LMeWw==';

function isDevBuild(): boolean {
  const env = (import.meta as ImportMeta & {
    env?: { DEV?: boolean; PROD?: boolean };
  }).env;
  const isDev = env?.DEV === true;
  const isProd = env?.PROD === true;
  // T1-81: defense-in-depth Layer 3. If both DEV and PROD are true, the build
  // is misconfigured. Fail safely toward production behavior — a free user
  // who shouldn't have Pro is preferable to every shipped build silently
  // auto-unlocking Pro for everyone. The console.error makes the
  // misconfiguration visible during testing. Layers 1 (build-time grep in
  // scripts/verify-production-build.mjs) and 2 (CI runs npm run build) are
  // the primary defenses; this is the runtime safety net.
  if (isDev && isProd) {
    console.error(
      '[EntitlementService] T1-81: Build misconfigured — both DEV and PROD '
      + 'are true. Treating as production for safety. Auto-Pro unlock disabled.',
    );
    return false;
  }
  return isDev;
}

export interface ActivateResult {
  ok: boolean;
  state?: EntitlementState;
  error?: string;
}

/**
 * T1-80: outcome of validating a stored license code. The caller (runInitialize)
 * maps each kind to a distinct EntitlementState so the UI can render the right
 * message instead of "you're free, no idea why".
 */
type StoredCodeValidation =
  | {
      kind: 'verified';
      tier: 'paid' | 'tester_permanent';
      label: string;
      features?: ReadonlyArray<ProFeature>;
      lastVerifiedAt?: number;
    }
  | {
      kind: 'offline_grace';
      label: string;
      graceUntil: number;
      features?: ReadonlyArray<ProFeature>;
      lastVerifiedAt?: number;
    }
  | { kind: 'verification_failed'; error: string }
  | { kind: 'revoked' };

export interface EntitlementServiceOptions {
  /**
   * T1-254: local cache authority must be a signed entitlement token.
   * Without a verifier, cache reads fail closed and the service falls
   * back to live verification instead of trusting raw JSON.
   */
  readonly signedTokenVerifier?: EntitlementVerifier | null;
  readonly now?: () => number;
}

export class EntitlementService {
  private state: EntitlementState = { tier: 'free', hasPro: false, status: 'free' };
  private listeners = new Set<() => void>();
  private initPromise: Promise<void> | null = null;
  private readonly signedTokenVerifier: EntitlementVerifier | null;
  private readonly now: () => number;

  constructor(options: EntitlementServiceOptions = {}) {
    this.signedTokenVerifier = options.signedTokenVerifier ?? null;
    this.now = options.now ?? (() => Date.now());
  }

  getState(): EntitlementState {
    return { ...this.state };
  }

  hasPro(): boolean {
    return this.state.hasPro;
  }

  /**
   * T2-92: per-feature entitlement check. Pre-T2-92 this method
   * ignored its argument and returned `state.hasPro` for every
   * feature. Now:
   *   1. developer / tester_permanent tiers act as wildcards (current
   *      behaviour preserved — internal builds keep all features),
   *   2. when `state.features` is populated (T2-89 server tokens), it
   *      is consulted as a membership check,
   *   3. when `state.features` is undefined, falls back to
   *      `state.hasPro` so callers that hand-build EntitlementState
   *      literals (or any path that hasn't migrated to per-feature
   *      tokens yet) keep working.
   */
  canUse(feature: ProFeature): boolean {
    if (this.state.tier === 'developer') return true;
    if (this.state.tier === 'tester_permanent') return true;
    if (this.state.features) {
      return this.state.features.includes(feature);
    }
    return this.state.hasPro;
  }

  isProFeatureId(id: string): id is ProFeature {
    return (PRO_FEATURES as readonly string[]).includes(id);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  private setState(next: EntitlementState): void {
    // T2-93: derive `statusDetail` from the T1-80 flat `status` field +
    // sibling metadata (lastVerifiedAt, graceUntil, lastError, label,
    // tier) at the single setState boundary. Existing call sites keep
    // setting the flat `status` string; the discriminated union is
    // populated automatically so all UI consumers can switch over
    // without touching the service.
    const statusDetail = next.statusDetail ?? deriveStatusDetail(next);
    this.state = { ...next, statusDetail };
    // T1-82: legacy PRO_FLAG_KEY ('laserforge_pro') write removed. The key
    // had no readers in src/, electron/, or any production code path —
    // verified at write-time via repo-wide grep (only EntitlementService
    // migration/deactivate references and tests/). Live writes were a foot-gun:
    // a future path reading localStorage.getItem('laserforge_pro') could see a
    // "current" value and bypass EntitlementService. Migration read path
    // (migrateFromLocalStorage) is preserved for very old upgrades; deactivate()
    // still removes the key explicitly. Future cleanup can drop migration once
    // legacy localStorage state has aged out.
    this.emit();
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.runInitialize();
    return this.initPromise;
  }

  private async runInitialize(): Promise<void> {
    await this.migrateFromLocalStorage();

    if (isDevBuild()) {
      this.setState({
        tier: 'developer',
        hasPro: true,
        status: 'developer',
        label: 'Developer build',
      });
      return;
    }

    const saved = await getStorage().get(STORAGE_KEY);
    if (!saved) {
      this.setState({ tier: 'free', hasPro: false, status: 'free' });
      return;
    }

    // T1-80: distinguish "verified", "offline_grace" (Pro stays active),
    // "verification_failed" (Pro off but code preserved for retry), and
    // "revoked" (Pro off, code preserved so the UI can say "contact
    // support"). Pre-T1-80 every non-verified outcome silently deleted
    // the stored license and rendered as "Free" — a paid user opening
    // the app during a Gumroad outage saw their Pro features locked
    // without explanation.
    const upper = saved.toUpperCase().trim();
    const result = await this.validateAndApplyStoredCode(saved);
    switch (result.kind) {
      case 'verified':
        this.setState({
          tier: result.tier,
          hasPro: true,
          status: result.tier === 'paid' ? 'verified' : 'tester',
          label: result.label,
          code: upper,
          lastVerifiedAt: result.lastVerifiedAt ?? this.now(),
          features: result.features,
        });
        return;
      case 'offline_grace':
        this.setState({
          tier: 'paid',
          hasPro: true,
          status: 'offline_grace',
          label: result.label,
          code: upper,
          lastVerifiedAt: result.lastVerifiedAt,
          graceUntil: result.graceUntil,
          features: result.features,
        });
        return;
      case 'revoked':
        // Code preserved (not removed) so the UI can show "License
        // revoked — contact support" rather than a silent downgrade.
        this.setState({
          tier: 'free',
          hasPro: false,
          status: 'revoked',
          code: upper,
        });
        return;
      case 'verification_failed':
        // Code preserved (not removed) so the user can retry without
        // re-entering. Pre-T1-80 the storage was wiped here.
        this.setState({
          tier: 'free',
          hasPro: false,
          status: 'verification_failed',
          code: upper,
          lastError: result.error,
        });
        return;
    }
  }

  private async migrateFromLocalStorage(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    const storage = getStorage();
    // T1-82: PRO_FLAG_KEY stays in this list as a one-time read for users who
    // still have the legacy localStorage slot. Live setState writes to this key
    // were removed. Migrated values may persist in the adapter until
    // deactivate(); nothing reads PRO_FLAG_KEY for authority — hasPro is canonical.
    const migrationKeys = [STORAGE_KEY, PRO_FLAG_KEY, LICENSE_CACHE_KEY];

    for (const key of migrationKeys) {
      try {
        const legacy = localStorage.getItem(key);
        if (legacy === null) continue;
        const existing = await storage.get(key);
        if (existing !== null) continue;
        await storage.set(key, legacy);
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }

  /** Session-only free tier (no license in storage); matches legacy TrialGuard behavior. */
  skipToFreeSession(): void {
    if (isDevBuild()) return;
    this.setState({ tier: 'free', hasPro: false, status: 'free', label: 'Free User' });
  }

  deactivate(): void {
    // T1-80: explicit deactivate is the only path that removes the stored
    // code. runInitialize's verification_failed / revoked paths preserve
    // the code so the user can retry / contact support without re-entering.
    Promise.all([
      getStorage().remove(STORAGE_KEY),
      getStorage().remove(PRO_FLAG_KEY),
    ]).catch(() => {
      /* ignore */
    });
    if (isDevBuild()) {
      this.setState({
        tier: 'developer',
        hasPro: true,
        status: 'developer',
        label: 'Developer build',
      });
    } else {
      this.setState({ tier: 'free', hasPro: false, status: 'free' });
    }
  }

  async activate(code: string): Promise<ActivateResult> {
    const trimmed = code.trim();
    if (!trimmed) {
      return { ok: false, error: 'Enter a license or tester key' };
    }

    if (isDevBuild()) {
      return {
        ok: true,
        state: this.getState(),
      };
    }

    const upper = trimmed.toUpperCase();

    if (parseTesterCode(trimmed)) {
      const ok = await verifyTesterCode(trimmed);
      if (ok) {
        const slug = parseTesterCode(trimmed)!.slug;
        await getStorage().set(STORAGE_KEY, upper);
        const next: EntitlementState = {
          tier: 'tester_permanent',
          hasPro: true,
          status: 'tester',
          label: slug,
          code: upper,
        };
        this.setState(next);
        return { ok: true, state: next };
      }
      return { ok: false, error: 'Invalid tester key' };
    }

    if (!/^[A-Z0-9-]{16,40}$/i.test(trimmed)) {
      return { ok: false, error: 'Invalid code or license key' };
    }

    const gum = await this.verifyGumroad(upper);
    if (!gum) {
      return { ok: false, error: 'Invalid code or license key' };
    }

    await getStorage().set(STORAGE_KEY, upper);
    const next: EntitlementState = {
      tier: 'paid',
      hasPro: true,
      status: 'verified',
      label: gum.name,
      code: upper,
      lastVerifiedAt: this.now(),
    };
    this.setState(next);
    return { ok: true, state: next };
  }

  /**
   * T1-80: returns a structured outcome instead of boolean. The caller
   * (runInitialize) decides what state to set; this function no longer
   * sets state directly so the four distinct outcomes (verified /
   * offline_grace / verification_failed / revoked) can be surfaced
   * with their own UI message instead of collapsing into "Free".
   */
  private async validateAndApplyStoredCode(saved: string): Promise<StoredCodeValidation> {
    const upper = saved.toUpperCase().trim();

    if (parseTesterCode(saved)) {
      const ok = await verifyTesterCode(saved);
      if (ok) {
        const slug = parseTesterCode(saved)!.slug;
        return { kind: 'verified', tier: 'tester_permanent', label: slug };
      }
      // Tester key parse OK but verification failed — could be revoked
      // (key deleted from issuer) or transient. Without a richer signal
      // from verifyTesterCode we treat as revoked.
      return { kind: 'revoked' };
    }

    return await this.verifyGumroadStructured(upper);
  }

  private async getCachedEntitlementToken(): Promise<unknown | null> {
    try {
      const raw = await getStorage().get(LICENSE_CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  private async clearCachedEntitlement(): Promise<void> {
    try {
      await getStorage().remove(LICENSE_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }

  private async validateSignedCache(): Promise<StoredCodeValidation | null> {
    if (this.signedTokenVerifier == null) return null;
    const token = await this.getCachedEntitlementToken();
    if (token == null) return null;

    const result = await verifyEntitlementToken({
      token,
      verifier: this.signedTokenVerifier,
      now: this.now(),
      replayMode: 'ignore',
    });
    if (!result.ok) {
      return {
        kind: 'verification_failed',
        error: verifyFailureMessage(result.reason),
      };
    }
    return signedPayloadToStoredValidation(result.payload, this.now());
  }

  /**
   * T1-80: structured variant of `verifyGumroad`. Distinguishes the four
   * outcomes the audit calls out:
   *  - `verified`: server confirmed valid + not refunded/chargebacked
   *  - `offline_grace`: signed cache token is older than fresh window
   *     but still within its signed expiry
   *  - `revoked`: server confirmed refunded / chargebacked / disputed
   *  - `verification_failed`: anything else (server says invalid OR
   *     network error with no usable cache)
   *
   * The legacy `verifyGumroad()` (returns name|null) stays for `activate()`
   * which has its own UX and doesn't need the four-outcome distinction.
   */
  private async verifyGumroadStructured(upper: string): Promise<StoredCodeValidation> {
    const signedCache = await this.validateSignedCache();
    if (signedCache?.kind === 'verified' || signedCache?.kind === 'offline_grace') {
      return signedCache;
    }

    try {
      const formData = new FormData();
      formData.append('product_id', GUMROAD_PRODUCT_ID);
      formData.append('license_key', upper);
      formData.append('increment_uses_count', 'false');

      const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        await this.clearCachedEntitlement();
        // HTTP error from server side — Gumroad says "we don't know this
        // key" or there was an upstream issue. Treat as verification
        // failed (could be transient or genuinely invalid; user can
        // retry).
        return {
          kind: 'verification_failed',
          error: `Gumroad responded with HTTP ${response.status}.`,
        };
      }

      const data = (await response.json()) as {
        success?: boolean;
        purchase?: {
          email?: string;
          refunded?: boolean;
          chargebacked?: boolean;
          disputed?: boolean;
        };
      };

      if (!data.success || !data.purchase) {
        await this.clearCachedEntitlement();
        return {
          kind: 'verification_failed',
          error: 'Gumroad reported the license could not be verified.',
        };
      }

      if (data.purchase.refunded || data.purchase.chargebacked || data.purchase.disputed) {
        await this.clearCachedEntitlement();
        return { kind: 'revoked' };
      }

      const name = data.purchase.email || 'PRO User';
      await this.clearCachedEntitlement();
      return { kind: 'verified', tier: 'paid', label: name };
    } catch (err) {
      console.warn('[EntitlementService] Network error during license check:', err);

      return {
        kind: 'verification_failed',
        error: signedCache?.kind === 'verification_failed'
          ? signedCache.error
          : err instanceof Error ? err.message : 'Network error during license check.',
      };
    }
  }

  private async verifyGumroad(upper: string): Promise<{ name: string } | null> {
    const signedCache = await this.validateSignedCache();
    if (signedCache?.kind === 'verified' || signedCache?.kind === 'offline_grace') {
      return { name: signedCache.label };
    }

    try {
      const formData = new FormData();
      formData.append('product_id', GUMROAD_PRODUCT_ID);
      formData.append('license_key', upper);
      formData.append('increment_uses_count', 'false');

      const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        await this.clearCachedEntitlement();
        return null;
      }

      const data = (await response.json()) as {
        success?: boolean;
        purchase?: {
          email?: string;
          refunded?: boolean;
          chargebacked?: boolean;
          disputed?: boolean;
        };
      };

      if (!data.success || !data.purchase) {
        await this.clearCachedEntitlement();
        return null;
      }

      if (data.purchase.refunded || data.purchase.chargebacked || data.purchase.disputed) {
        await this.clearCachedEntitlement();
        return null;
      }

      const name = data.purchase.email || 'PRO User';
      await this.clearCachedEntitlement();
      return { name };
    } catch (err) {
      console.warn('[EntitlementService] Network error during license check:', err);

      return null;
    }
  }
}

function signedPayloadToStoredValidation(
  payload: EntitlementTokenPayload,
  now: number,
): StoredCodeValidation {
  if (payload.tier === 'free') {
    return {
      kind: 'verification_failed',
      error: 'Signed entitlement is free-tier.',
    };
  }

  const tier: 'paid' | 'tester_permanent' =
    payload.tier === 'tester' ? 'tester_permanent' : 'paid';
  const features = filterTokenFeatures(payload.features);

  if (now - payload.iat < LICENSE_CACHE_MAX_AGE) {
    return {
      kind: 'verified',
      tier,
      label: payload.sub,
      features,
      lastVerifiedAt: payload.iat,
    };
  }

  return {
    kind: 'offline_grace',
    label: payload.sub,
    graceUntil: payload.exp,
    features,
    lastVerifiedAt: payload.iat,
  };
}

function filterTokenFeatures(features: readonly string[]): ReadonlyArray<ProFeature> {
  return features.filter((feature): feature is ProFeature =>
    (PRO_FEATURES as readonly string[]).includes(feature),
  );
}

/**
 * T2-93: bridge from flat-`status` + sibling fields to the
 * discriminated `LicenseStatusDetail` union. Falls back to `'free'`
 * when status is undefined (back-compat for legacy callers that
 * predate T1-80 and only set tier/hasPro).
 */
function deriveStatusDetail(state: EntitlementState): import('./LicenseStatus').LicenseStatusDetail {
  const s = state.status;
  if (s == null) {
    if (state.tier === 'developer') return { kind: 'developer' };
    if (state.tier === 'tester_permanent') {
      return { kind: 'tester', testerSlug: state.label ?? 'unknown' };
    }
    return { kind: 'free' };
  }
  return buildStatusDetail({
    status: s,
    lastVerifiedAt: state.lastVerifiedAt,
    graceUntil: state.graceUntil,
    lastError: state.lastError,
    testerSlug: s === 'tester' ? state.label : undefined,
  });
}

export const entitlementService = new EntitlementService();

export function tierDisplayName(tier: EntitlementTier): string {
  switch (tier) {
    case 'developer':
      return 'Developer';
    case 'tester_permanent':
      return 'Tester';
    case 'paid':
      return 'PRO';
    case 'trial':
      return 'Trial';
    default:
      return 'Free';
  }
}
