// Camera addresses carrying a stand-in secret in each place an address can
// hold one, with the public form that may be saved (ADR-692 and Amendment 1:
// scheme, host and port; the scheme alone when the address reads more than one
// way). Test-only.

export const STAND_IN_SECRET = 'stand-in-secret-0';

export type CameraLoginForm = {
  readonly label: string;
  readonly kind: 'machine-rtsp' | 'machine-jpeg';
  readonly address: string;
  readonly publicForm: string;
  /** False for an address no camera answers, so no calibration is ever bound to it. */
  readonly connects: boolean;
};

const S = STAND_IN_SECRET;

const rtsp = (label: string, address: string, publicForm: string, connects = true) =>
  ({ label, kind: 'machine-rtsp', address, publicForm, connects }) as const;
const snapshot = (label: string, address: string, publicForm: string) =>
  ({ label, kind: 'machine-jpeg', address, publicForm, connects: true }) as const;

export const CAMERA_LOGIN_FORMS: readonly CameraLoginForm[] = [
  rtsp('userinfo', `rtsp://viewer:${S}@192.168.1.10:554/stream1`, 'rtsp://192.168.1.10:554/'),
  rtsp(
    'query',
    `rtsp://192.168.1.10:554/stream1?user=viewer&password=${S}`,
    'rtsp://192.168.1.10:554/',
  ),
  rtsp(
    'path fields split by &',
    `rtsp://192.168.1.10:554/user=viewer&password=${S}&channel=1&stream=0.sdp?`,
    'rtsp://192.168.1.10:554/',
  ),
  rtsp(
    'path fields split by _',
    `rtsp://192.168.1.10:554/user=viewer_password=${S}_channel=1_stream=0.sdp?real_stream`,
    'rtsp://192.168.1.10:554/',
  ),
  rtsp(
    'path fields split by ;',
    `rtsp://192.168.1.10/user=viewer;password=${S};channel=1`,
    'rtsp://192.168.1.10/',
  ),
  rtsp(
    'path field after a stream path, any case',
    `rtsp://192.168.1.10/live/ch1/Pwd=${S}`,
    'rtsp://192.168.1.10/',
  ),
  rtsp(
    'path fields percent-encoded',
    `rtsp://192.168.1.10/user%3Dviewer%26password%3D${S}`,
    'rtsp://192.168.1.10/',
  ),
  rtsp(
    'short unnamed path fields',
    `rtsp://192.168.1.64:554/u=viewer&p=${S}/live`,
    'rtsp://192.168.1.64:554/',
  ),
  rtsp('a path token', `rtsp://192.168.1.1:7447/${S}`, 'rtsp://192.168.1.1:7447/'),
  rtsp(
    'userinfo with an unencoded slash',
    `rtsp://viewer:part/${S}@192.168.1.10:554/stream1`,
    'rtsp://',
    false,
  ),
  rtsp(
    'userinfo whose slash makes part of it read as a port',
    `rtsp://viewer:1234/${S}@192.168.1.10:554/stream1`,
    'rtsp://',
    false,
  ),
  rtsp('userinfo with an unencoded #', `rtsp://viewer:4711#${S}@192.168.1.64/s`, 'rtsp://', false),
  rtsp('userinfo with an unencoded ?', `rtsp://viewer:4711?${S}@192.168.1.64/s`, 'rtsp://', false),
  rtsp('userinfo with @ then #', `rtsp://viewer:a@${S}#x@192.168.1.64/s`, 'rtsp://', false),
  rtsp('userinfo with an encoded @', `rtsp://viewer:${S}%40192.168.1.64:554/s`, 'rtsp://', false),
  rtsp('userinfo encoded whole', `rtsp://viewer%3A${S}%40192.168.1.64:554/s`, 'rtsp://', false),
  rtsp('userinfo with no @', `rtsp://viewer:${S}192.168.1.64/s`, 'rtsp://', false),
  snapshot(
    'snapshot query',
    `http://192.168.1.20/cgi-bin/snapshot.cgi?loginuse=viewer&loginpas=${S}`,
    'http://192.168.1.20/',
  ),
  snapshot(
    'snapshot key in the path',
    `http://192.168.1.20:8080/${S}/jpeg/g/m/s.jpg`,
    'http://192.168.1.20:8080/',
  ),
  snapshot(
    'snapshot session parameter',
    `http://192.168.1.20:8080/shot.jpg;jsessionid=${S}`,
    'http://192.168.1.20:8080/',
  ),
];

/** Addresses with no login: their public form is still the scheme, host and port. */
export const PLAIN_CAMERA_ADDRESSES: readonly {
  readonly address: string;
  readonly publicForm: string;
}[] = [
  { address: 'rtsp://192.168.1.10:554/stream1', publicForm: 'rtsp://192.168.1.10:554/' },
  { address: 'rtsp://192.168.10.1:8554/', publicForm: 'rtsp://192.168.10.1:8554/' },
  { address: 'rtsp://192.168.1.10/cam/realmonitor', publicForm: 'rtsp://192.168.1.10/' },
  { address: 'rtsp://shop-camera.local:554/h264', publicForm: 'rtsp://shop-camera.local:554/' },
  { address: 'rtsp://[fd00::20]:554/live', publicForm: 'rtsp://[fd00::20]:554/' },
  { address: 'http://192.168.1.20:8080/shot.jpg', publicForm: 'http://192.168.1.20:8080/' },
];
