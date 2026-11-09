// Camera addresses carrying a stand-in login in each place an address can
// hold one, with the public form that may be saved (ADR-692). Test-only.

export const STAND_IN_SECRET = 'stand-in-secret-0';

export type CameraLoginForm = {
  readonly label: string;
  readonly kind: 'machine-rtsp' | 'machine-jpeg';
  readonly address: string;
  readonly publicForm: string;
};

const S = STAND_IN_SECRET;

export const CAMERA_LOGIN_FORMS: readonly CameraLoginForm[] = [
  {
    label: 'userinfo',
    kind: 'machine-rtsp',
    address: `rtsp://viewer:${S}@192.168.1.10:554/stream1`,
    publicForm: 'rtsp://192.168.1.10:554/stream1',
  },
  {
    label: 'query',
    kind: 'machine-rtsp',
    address: `rtsp://192.168.1.10:554/stream1?user=viewer&password=${S}`,
    publicForm: 'rtsp://192.168.1.10:554/stream1',
  },
  {
    label: 'path fields split by &',
    kind: 'machine-rtsp',
    address: `rtsp://192.168.1.10:554/user=viewer&password=${S}&channel=1&stream=0.sdp?`,
    publicForm: 'rtsp://192.168.1.10:554/',
  },
  {
    label: 'path fields split by _',
    kind: 'machine-rtsp',
    address: `rtsp://192.168.1.10:554/user=viewer_password=${S}_channel=1_stream=0.sdp?real_stream`,
    publicForm: 'rtsp://192.168.1.10:554/',
  },
  {
    label: 'path fields split by ;',
    kind: 'machine-rtsp',
    address: `rtsp://192.168.1.10/user=viewer;password=${S};channel=1`,
    publicForm: 'rtsp://192.168.1.10/',
  },
  {
    label: 'path field after a stream path, any case',
    kind: 'machine-rtsp',
    address: `rtsp://192.168.1.10/live/ch1/Pwd=${S}`,
    publicForm: 'rtsp://192.168.1.10/live/ch1/',
  },
  {
    label: 'path fields percent-encoded',
    kind: 'machine-rtsp',
    address: `rtsp://192.168.1.10/user%3Dviewer%26password%3D${S}`,
    publicForm: 'rtsp://192.168.1.10/',
  },
  {
    label: 'userinfo with an unencoded slash',
    kind: 'machine-rtsp',
    address: `rtsp://viewer:part/${S}@192.168.1.10:554/stream1`,
    publicForm: 'rtsp://192.168.1.10:554/stream1',
  },
  {
    label: 'userinfo whose slash makes part of it read as a port',
    kind: 'machine-rtsp',
    address: `rtsp://viewer:1234/${S}@192.168.1.10:554/stream1`,
    publicForm: 'rtsp://192.168.1.10:554/stream1',
  },
  {
    label: 'snapshot query',
    kind: 'machine-jpeg',
    address: `http://192.168.1.20/cgi-bin/snapshot.cgi?loginuse=viewer&loginpas=${S}`,
    publicForm: 'http://192.168.1.20/cgi-bin/snapshot.cgi',
  },
];

/** Addresses with no login, which stay exactly as they were saved before. */
export const PLAIN_CAMERA_ADDRESSES: readonly string[] = [
  'rtsp://192.168.1.10:554/stream1',
  'rtsp://192.168.10.1:8554/',
  'rtsp://192.168.1.10/cam/realmonitor',
  'rtsp://192.168.1.10:554/Streaming/Channels/101',
  'rtsp://192.168.1.10:554/h264/ch1/main/av_stream',
  'http://192.168.1.20:8080/shot.jpg',
];
