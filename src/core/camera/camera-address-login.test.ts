import { describe, expect, it } from 'vitest';
import {
  cameraAddressHasLogin,
  cameraAddressWithoutUserinfo,
  publicCameraAddress,
} from './camera-address-login';
import { cameraSourceIdWithoutCredentials } from './camera-capture-binding';
import {
  CAMERA_LOGIN_FORMS,
  PLAIN_CAMERA_ADDRESSES,
  STAND_IN_SECRET,
} from './camera-login-forms.test-fixture';

describe('the public form of a camera address (ADR-692)', () => {
  it.each(CAMERA_LOGIN_FORMS)('keeps no login from the $label form', (form) => {
    const safe = publicCameraAddress(form.address);
    expect(safe).toBe(form.publicForm);
    expect(safe).not.toContain(STAND_IN_SECRET);
    expect(cameraSourceIdWithoutCredentials(form.address)).toBe(form.publicForm);
    expect(cameraAddressHasLogin(form.address)).toBe(true);
  });

  it.each(CAMERA_LOGIN_FORMS)('is stable when read again ($label)', (form) => {
    expect(publicCameraAddress(form.publicForm)).toBe(form.publicForm);
    expect(cameraAddressHasLogin(form.publicForm)).toBe(false);
  });

  it.each(PLAIN_CAMERA_ADDRESSES)('leaves an address with no login as it was: %s', (address) => {
    expect(publicCameraAddress(address)).toBe(address);
    expect(cameraAddressHasLogin(address)).toBe(false);
  });

  it('keys the resource identity on the whole path, as before, so saved fingerprints still match', () => {
    const form = CAMERA_LOGIN_FORMS.find((f) => f.label === 'path fields split by &');
    expect(form).toBeDefined();
    // The keyed identity is never written in the clear; it must not change shape.
    expect(cameraAddressWithoutUserinfo(form?.address ?? '')).toContain('channel=1');
  });
});
