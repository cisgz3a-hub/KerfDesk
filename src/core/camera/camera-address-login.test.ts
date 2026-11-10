import { describe, expect, it } from 'vitest';
import {
  cameraAddressHasPrivateParts,
  cameraAddressWithoutUserinfo,
  publicCameraAddress,
} from './camera-address-login';
import { cameraSourceIdWithoutCredentials } from './camera-capture-binding';
import {
  CAMERA_LOGIN_FORMS,
  PLAIN_CAMERA_ADDRESSES,
  STAND_IN_SECRET,
} from './camera-login-forms.test-fixture';

describe('the public form of a camera address (ADR-692 Amendment 1)', () => {
  it.each(CAMERA_LOGIN_FORMS)('keeps no secret from the $label form', (form) => {
    const safe = publicCameraAddress(form.address);
    expect(safe).toBe(form.publicForm);
    expect(safe).not.toContain(STAND_IN_SECRET);
    expect(safe).not.toContain('viewer');
    expect(cameraSourceIdWithoutCredentials(form.address)).toBe(form.publicForm);
    expect(cameraAddressHasPrivateParts(form.address)).toBe(true);
  });

  it.each(CAMERA_LOGIN_FORMS)('is stable when read again ($label)', (form) => {
    expect(publicCameraAddress(form.publicForm)).toBe(form.publicForm);
  });

  it.each(PLAIN_CAMERA_ADDRESSES)('is the scheme, host and port of $address', (plain) => {
    expect(publicCameraAddress(plain.address)).toBe(plain.publicForm);
    expect(publicCameraAddress(plain.publicForm)).toBe(plain.publicForm);
    expect(cameraAddressHasPrivateParts(plain.publicForm)).toBe(false);
  });

  it('keys the resource identity on the whole path, as before, so saved fingerprints still match', () => {
    const form = CAMERA_LOGIN_FORMS.find((f) => f.label === 'path fields split by &');
    expect(form).toBeDefined();
    // The keyed identity is never written in the clear; it must not change shape.
    expect(cameraAddressWithoutUserinfo(form?.address ?? '')).toContain('channel=1');
  });

  it('keeps only a word for an address with no scheme at all', () => {
    expect(publicCameraAddress(`viewer:${STAND_IN_SECRET}@192.168.1.10`)).toBe('camera');
  });
});
