import type { EntitlementState, EntitlementTier, ProFeature, StoredLicenseCacheEntry } from './types';
import { PRO_FEATURES } from './types';
import { parseTesterCode, verifyTesterCode } from './testerKey';

const STORAGE_KEY = 'laserforge_license';
const PRO_FLAG_KEY = 'laserforge_pro';
const LICENSE_CACHE_KEY = 'laserforge_license_cache';
const LICENSE_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const LICENSE_OFFLINE_GRACE = 30 * 24 * 60 * 60 * 1000;

const GUMROAD_PRODUCT_ID = 'Fpj-vH0Hklzn3O2j5LMeWw==';

function getCachedLicense(code: string): StoredLicenseCacheEntry | null {
  try {
    const raw = localStorage.getItem(LICENSE_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as StoredLicenseCacheEntry;
    if (entry.code !== code.toUpperCase().trim()) return null;
    return entry;
  } catch {
    return null;
  }
}

function setCachedLicense(code: string, name: string, valid: boolean): void {
  const entry: StoredLicenseCacheEntry = {
    code: code.toUpperCase().trim(),
    name,
    validatedAt: Date.now(),
    valid,
  };
  localStorage.setItem(LICENSE_CACHE_KEY, JSON.stringify(entry));
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
    try {
      if (next.hasPro) {
        localStorage.setItem(PRO_FLAG_KEY, 'true');
      } else {
        localStorage.removeItem(PRO_FLAG_KEY);
      }
    } catch {
      /* ignore */
    }
    this.emit();
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.runInitialize();
    return this.initPromise;
  }

  private async runInitialize(): Promise<void> {
    if (import.meta.env.DEV) {
      this.setState({
        tier: 'developer',
        hasPro: true,
        label: 'Developer build',
      });
      return;
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      this.setState({ tier: 'free', hasPro: false });
      return;
    }

    const applied = await this.validateAndApplyStoredCode(saved);
    if (!applied) {
      localStorage.removeItem(STORAGE_KEY);
      this.setState({ tier: 'free', hasPro: false });
    }
  }

  /** Session-only free tier (no license in storage); matches legacy TrialGuard behavior. */
  skipToFreeSession(): void {
    if (import.meta.env.DEV) return;
    this.setState({ tier: 'free', hasPro: false, label: 'Free User' });
  }

  deactivate(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PRO_FLAG_KEY);
    } catch {
      /* ignore */
    }
    if (import.meta.env.DEV) {
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

    if (import.meta.env.DEV) {
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
        localStorage.setItem(STORAGE_KEY, upper);
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

    localStorage.setItem(STORAGE_KEY, upper);
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

  private async verifyGumroad(upper: string): Promise<{ name: string } | null> {
    const cached = getCachedLicense(upper);
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
        setCachedLicense(upper, '', false);
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
        setCachedLicense(upper, '', false);
        return null;
      }

      if (data.purchase.refunded || data.purchase.chargebacked || data.purchase.disputed) {
        setCachedLicense(upper, '', false);
        return null;
      }

      const name = data.purchase.email || 'PRO User';
      setCachedLicense(upper, name, true);
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
