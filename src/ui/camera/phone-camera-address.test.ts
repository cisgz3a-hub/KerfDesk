import { describe, expect, it } from 'vitest';
import { phoneCameraAddress, phoneCameraAddressWithoutLogin } from './phone-camera-address';

describe('phoneCameraAddress', () => {
  it.each([
    ['192.168.1.50', 'http://192.168.1.50:8080/shot.jpg'],
    ['192.168.1.50:8080', 'http://192.168.1.50:8080/shot.jpg'],
    [' http://192.168.1.50:8080/ ', 'http://192.168.1.50:8080/shot.jpg'],
    ['192.168.1.50:8081', 'http://192.168.1.50:8081/shot.jpg'],
    ['https://10.0.0.7:8080', 'https://10.0.0.7:8080/shot.jpg'],
    ['admin:secret@192.168.1.50', 'http://admin:secret@192.168.1.50:8080/shot.jpg'],
  ])('turns what IP Webcam shows (%s) into its still address', (typed, url) => {
    expect(phoneCameraAddress('ip-webcam', typed)).toEqual({ kind: 'snapshot', url });
  });

  it('takes any other app’s picture address as it is', () => {
    expect(phoneCameraAddress('other', 'http://192.168.1.60:4747/cam/1/frame.jpg')).toEqual({
      kind: 'snapshot',
      url: 'http://192.168.1.60:4747/cam/1/frame.jpg',
    });
    expect(phoneCameraAddress('other', 'http://192.168.1.61/?action=snapshot')).toEqual({
      kind: 'snapshot',
      url: 'http://192.168.1.61/?action=snapshot',
    });
  });

  it('sends a video stream address to the RTSP camera section', () => {
    expect(phoneCameraAddress('other', 'rtsp://192.168.1.60:8554/live')).toEqual({
      kind: 'invalid',
      message: 'That is a video stream address. Paste it under RTSP camera… instead.',
    });
  });

  it.each([
    ['admin:secret@192.168.1.50:8080', '192.168.1.50:8080'],
    ['http://admin:secret@192.168.1.50:8080/', 'http://192.168.1.50:8080/'],
    ['http://192.168.1.61/?action=snapshot', 'http://192.168.1.61/?action=snapshot'],
  ])('never keeps a login in the address it stores (%s)', (typed, stored) => {
    expect(phoneCameraAddressWithoutLogin(typed)).toBe(stored);
  });

  it('says what to enter when the address cannot be used', () => {
    expect(phoneCameraAddress('ip-webcam', '')).toMatchObject({ kind: 'invalid' });
    expect(phoneCameraAddress('ip-webcam', 'rtsp://192.168.1.50:8080')).toMatchObject({
      kind: 'invalid',
    });
    expect(phoneCameraAddress('other', '192.168.1.60')).toMatchObject({
      kind: 'invalid',
      message: 'Enter the full picture address from the app, starting with http://.',
    });
  });
});
