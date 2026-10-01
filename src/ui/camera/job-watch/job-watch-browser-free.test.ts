import { afterEach, expect, it, vi } from 'vitest';
import { savedCameraModel } from '../../../core/camera/model/model-fixtures';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { cameraCaptureBindingForFrame, type ActiveCameraSource } from '../frame-source';
import { watchCameraNow } from './job-watch-camera';

// The browser build replaces this module with inert model consumers. Job Watch
// must respect that contract instead of reopening a raw saved calibration.
vi.mock('../active-camera-model', () => ({ ownCameraModel: () => undefined }));

const initialProject = useStore.getState().project;
const initialCamera = useCameraStore.getState();
afterEach(() => {
  useStore.setState({ project: initialProject });
  useCameraStore.setState(initialCamera);
});

it('keeps raw camera viewing but cannot recover calibrated alignment through Job Watch', () => {
  const source: ActiveCameraSource = {
    kind: 'machine-jpeg',
    cameraUrl: 'http://camera.local/picture.jpg',
    frameUrl: 'http://localhost/frame.jpg',
  };
  const model = { ...savedCameraModel(), capture: cameraCaptureBindingForFrame(source, 1280, 720) };
  useStore.setState({
    project: {
      ...initialProject,
      device: { ...initialProject.device, cameraModel: model },
    },
  });
  useCameraStore.setState({ sourceState: { kind: 'live', source } });
  expect(watchCameraNow()).toMatchObject({ source, fixedModel: null });
});
