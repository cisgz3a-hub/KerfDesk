import type { EntitlementState, EntitlementTier, ProFeature, StoredLicenseCacheEntry } from './types';
import { PRO_FEATURES } from './types';
import { parseTesterCode, verifyTesterCode } from './testerKey';
import { getStorage } from '../core/storage/storage';

const STORAGE_KEY = 'laserforge_license';
const PRO_FLAG_KEY = 'laserforge_pro';
const LICENSE_CACHE_KEY = 'laserforge_license_cache';
const LICENSE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const LICENSE_OFFLINE_GRACE = 30 * 24 * 60 * 60 * 1000;

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

export class EntitlementService {
  private state: EntitlementState = { tier: 'free', hasPro: false };
  private listeners = new Set<() => void>();
  private initPromise: Promise<void> | null = null;

  getState(): EntitlementState {
    return { ...this.state };
  }

  hasPro(): boolean {
    return this.state.hasPro;
  }

  canUse(feature: ProFeature): boolean {
    void feature;
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
    this.state = next;
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
        label: 'Developer build',
      });
      return;
    }

    const saved = await getStorage().get(STORAGE_KEY);
    if (!saved) {
      this.setState({ tier: 'free', hasPro: false });
      return;
    }

    const applied = await this.validateAndApplyStoredCode(saved);
    if (!applied) {
      await getStorage().remove(STORAGE_KEY);
      this.setState({ tier: 'free', hasPro: false });
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
    this.setState({ tier: 'free', hasPro: false, label: 'Free User' });
  }

  deactivate(): void {
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
        label: 'Developer build',
      });
    } else {
      this.setState({ tier: 'free', hasPro: false });
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
      label: gum.name,
      code: upper,
    };
    this.setState(next);
    return { ok: true, state: next };
  }

  private async validateAndApplyStoredCode(saved: string): Promise<boolean> {
    const upper = saved.toUpperCase().trim();

    if (parseTesterCode(saved)) {
      const ok = await verifyTesterCode(saved);
      if (ok) {
        const slug = parseTesterCode(saved)!.slug;
        this.setState({
          tier: 'tester_permanent',
          hasPro: true,
          label: slug,
          code: upper,
        });
        return true;
      }
      return false;
    }

    const gum = await this.verifyGumroad(upper);
    if (gum) {
      this.setState({
        tier: 'paid',
        hasPro: true,
        label: gum.name,
        code: upper,
      });
      return true;
    }

    return false;
  }

  private async getCachedLicense(code: string): Promise<StoredLicenseCacheEntry | null> {
    try {
      const raw = await getStorage().get(LICENSE_CACHE_KEY);
      if (!raw) return null;
      const entry = JSON.parse(raw) as StoredLicenseCacheEntry;
      if (entry.code !== code.toUpperCase().trim()) return null;
      return entry;
    } catch {
      return null;
    }
  }

  private async setCachedLicense(code: string, name: string, valid: boolean): Promise<void> {
    const entry: StoredLicenseCacheEntry = {
      code: code.toUpperCase().trim(),
      name,
      validatedAt: Date.now(),
      valid,
    };
    try {
      await getStorage().set(LICENSE_CACHE_KEY, JSON.stringify(entry));
    } catch {
      /* ignore */
    }
  }

  private async verifyGumroad(upper: string): Promise<{ name: string } | null> {
    const cached = await this.getCachedLicense(upper);
    if (cached && cached.valid) {
      const age = Date.now() - cached.validatedAt;
      if (age < LICENSE_CACHE_MAX_AGE) {
        return { name: cached.name };
      }
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
        await this.setCachedLicense(upper, '', false);
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
        await this.setCachedLicense(upper, '', false);
        return null;
      }

      if (data.purchase.refunded || data.purchase.chargebacked || data.purchase.disputed) {
        await this.setCachedLicense(upper, '', false);
        return null;
      }

      const name = data.purchase.email || 'PRO User';
      await this.setCachedLicense(upper, name, true);
      return { name };
    } catch (err) {
      console.warn('[EntitlementService] Network error during license check:', err);

      if (cached && cached.valid) {
        const age = Date.now() - cached.validatedAt;
        if (age < LICENSE_OFFLINE_GRACE) {
          return { name: cached.name };
        }
      }

      return null;
    }
  }
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
