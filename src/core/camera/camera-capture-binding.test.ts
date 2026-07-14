import { describe, expect, it } from 'vitest';
import {
  cameraBindingCompatibility,
  normalizeCameraCaptureBinding,
  type CameraCaptureBinding,
} from './camera-capture-binding';

const USB: CameraCaptureBinding = {
  version: 1,
  sourceKind: 'usb',
  sourceId: 'overhead-camera',
  width: 1920,
  height: 1080,
  resizeMode: 'none',
};

describe('camera capture binding', () => {
  it('normalizes a valid persisted binding and rejects malformed or secret-prone shapes', () => {
    expect(normalizeCameraCaptureBinding(USB)).toEqual(USB);
    expect(normalizeCameraCaptureBinding({ ...USB, version: 2 })).toBeUndefined();
    expect(normalizeCameraCaptureBinding({ ...USB, sourceId: '' })).toBeUndefined();
    expect(normalizeCameraCaptureBinding({ ...USB, width: 0 })).toBeUndefined();
    expect(normalizeCameraCaptureBinding({ ...USB, resizeMode: 'maybe' })).toBeUndefined();
  });

  it('accepts pure same-aspect resizing but refuses source, aspect, or crop changes', () => {
    expect(cameraBindingCompatibility(USB, { ...USB, width: 1280, height: 720 })).toBe('match');
    expect(cameraBindingCompatibility(USB, { ...USB, sourceId: 'laptop-camera' })).toBe(
      'source-mismatch',
    );
    expect(cameraBindingCompatibility(USB, { ...USB, width: 1280, height: 960 })).toBe(
      'geometry-mismatch',
    );
    expect(
      cameraBindingCompatibility(
        { ...USB, resizeMode: 'crop-and-scale' },
        { ...USB, width: 1280, height: 720, resizeMode: 'crop-and-scale' },
      ),
    ).toBe('geometry-mismatch');
  });

  it('marks legacy records without a binding as unbound', () => {
    expect(cameraBindingCompatibility(undefined, USB)).toBe('unbound');
  });
});
