import { device, identifier, requireValue, secret, text } from './validation.mjs';

const DAY = 86_400;
const MAX_DEVICES = 3;

export function nextUpdateYear(seconds) {
  const date = new Date(seconds * 1000);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  // A leap-day anniversary is the last day of February, not March 1.
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return Math.floor(date.getTime() / 1000);
}

export class LicensingAuthority {
  constructor(records, cryptography, now = () => Math.floor(Date.now() / 1000)) {
    this.records = records;
    this.crypto = cryptography;
    this.now = now;
  }

  async licenseKey(licenseId) {
    return `KD1.${licenseId}.${await this.crypto.derive('license-key', licenseId)}`;
  }

  async activationToken(activationId) {
    return this.crypto.derive('activation-token', activationId);
  }

  async authenticateLicense(key) {
    text(key, 80, 100);
    const parts = key.split('.');
    requireValue(parts.length === 3 && parts[0] === 'KD1', 401, 'invalid_credentials');
    const license = this.records.get(`license:${identifier(parts[1])}`);
    requireValue(
      license?.keyHash && (await this.crypto.matches('license-key', key, license.keyHash)),
      401,
      'invalid_credentials',
    );
    requireValue(license.status === 'active', 403, 'license_inactive');
    return license;
  }

  async developerGrant(body) {
    const grantId = identifier(body.grantId);
    const displayName = text(body.displayName, 1, 100);
    const licenseId = this.crypto.id();
    const keyHash = await this.crypto.hash('license-key', await this.licenseKey(licenseId));
    const license = this.records.transaction((tx) => {
      const existing = tx.get(`grant:${grantId}`);
      if (existing) {
        requireValue(existing.displayName === displayName, 409, 'idempotency_conflict');
        return tx.get(`license:${existing.licenseId}`);
      }
      const created = {
        licenseId,
        tier: 'developer',
        status: 'active',
        issuedAt: this.now(),
        accessExpiresAt: null,
        updatesUntil: null,
        perpetualUpdates: true,
        keyHash,
        active: [],
      };
      tx.put(`license:${licenseId}`, created);
      tx.put(`grant:${grantId}`, { licenseId, displayName });
      return created;
    });
    return {
      licenseId: license.licenseId,
      licenseKey: await this.licenseKey(license.licenseId),
      displayName,
    };
  }

  async startTrial(body) {
    const deviceId = device(body.deviceId);
    const deviceHash = await this.crypto.hash('device', deviceId);
    const trialId = `trial-${deviceHash}`;
    const now = this.now();
    this.records.transaction((tx) => {
      if (tx.get(`license:${trialId}`)) return;
      tx.put(`license:${trialId}`, {
        licenseId: trialId,
        tier: 'trial',
        status: 'active',
        issuedAt: now,
        accessExpiresAt: now + 30 * DAY,
        updatesUntil: now + 30 * DAY,
        perpetualUpdates: false,
        active: [],
      });
    });
    return this.allocate(trialId, body, deviceHash);
  }

  async activate(body) {
    const license = await this.authenticateLicense(body.licenseKey);
    requireValue(license.tier !== 'trial', 403, 'invalid_license_tier');
    return this.allocate(
      license.licenseId,
      body,
      await this.crypto.hash('device', device(body.deviceId)),
    );
  }

  async allocate(licenseId, body, deviceHash) {
    const deviceId = device(body.deviceId);
    const deviceName = text(body.deviceName, 1, 80);
    const activationId = this.crypto.id();
    const tokenHash = await this.crypto.hash(
      'activation-token',
      await this.activationToken(activationId),
    );
    const now = this.now();
    const result = this.records.transaction((tx) => {
      const license = tx.get(`license:${licenseId}`);
      this.usable(license, now);
      const existing = license.active
        .map((id) => tx.get(`activation:${id}`))
        .find((item) => item.deviceHash === deviceHash);
      if (existing) return { license, activation: existing };
      requireValue(license.active.length < MAX_DEVICES, 409, 'device_limit_reached');
      const activation = {
        activationId,
        licenseId,
        deviceHash,
        deviceName,
        tokenHash,
        active: true,
        createdAt: now,
      };
      license.active.push(activationId);
      tx.put(`activation:${activationId}`, activation);
      tx.put(`license:${licenseId}`, license);
      return { license, activation };
    });
    return this.issue(result.license, result.activation, deviceId);
  }

  usable(license, now) {
    requireValue(license?.status === 'active', 403, 'license_inactive');
    requireValue(
      license.accessExpiresAt === null || license.accessExpiresAt > now,
      403,
      'trial_expired',
    );
  }

  async authenticateActivation(body) {
    const licenseId = identifier(body.licenseId);
    const activationId = identifier(body.activationId);
    const deviceHash = await this.crypto.hash('device', device(body.deviceId));
    const activation = this.records.get(`activation:${activationId}`);
    requireValue(
      activation?.licenseId === licenseId && activation.deviceHash === deviceHash,
      401,
      'invalid_credentials',
    );
    requireValue(
      await this.crypto.matches(
        'activation-token',
        secret(body.activationToken),
        activation.tokenHash,
      ),
      401,
      'invalid_credentials',
    );
    return activation;
  }

  async refresh(body) {
    const authenticated = await this.authenticateActivation(body);
    const result = this.records.transaction((tx) => {
      const activation = tx.get(`activation:${authenticated.activationId}`);
      const license = tx.get(`license:${activation.licenseId}`);
      this.usable(license, this.now());
      requireValue(
        activation.active && license.active.includes(activation.activationId),
        403,
        'activation_inactive',
      );
      return { license, activation };
    });
    return this.issue(result.license, result.activation, body.deviceId);
  }

  async deactivate(body) {
    const activation = await this.authenticateActivation(body);
    return this.release(activation.licenseId, activation.activationId);
  }

  async releaseWithKey(body) {
    const license = await this.authenticateLicense(body.licenseKey);
    return this.release(license.licenseId, identifier(body.activationId));
  }

  release(licenseId, activationId) {
    return this.records.transaction((tx) => {
      const activation = tx.get(`activation:${activationId}`);
      requireValue(activation?.licenseId === licenseId, 404, 'activation_not_found');
      const license = tx.get(`license:${licenseId}`);
      activation.active = false;
      license.active = license.active.filter((id) => id !== activationId);
      tx.put(`activation:${activationId}`, activation);
      tx.put(`license:${licenseId}`, license);
      return { deactivated: true };
    });
  }

  async listActivations(body) {
    const license = await this.authenticateLicense(body.licenseKey);
    return {
      activations: license.active.map((id) => {
        const activation = this.records.get(`activation:${id}`);
        return {
          activationId: id,
          deviceName: activation.deviceName,
          createdAt: activation.createdAt,
        };
      }),
    };
  }

  async issue(license, activation, deviceId) {
    const claims = {
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      licenseId: license.licenseId,
      activationId: activation.activationId,
      deviceId,
      tier: license.tier,
      issuedAt: this.now(),
      accessExpiresAt: license.accessExpiresAt,
      updatesUntil: license.updatesUntil,
      perpetualUpdates: license.perpetualUpdates,
      maxDevices: MAX_DEVICES,
    };
    return {
      entitlement: await this.crypto.sign(claims),
      activationToken: await this.activationToken(activation.activationId),
    };
  }
}
