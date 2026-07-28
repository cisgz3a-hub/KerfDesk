import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../core/devices';
import {
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../core/scene';

const ROTARY_RASTER_COLOR = '#808080';
const ROTARY_RASTER_ID = 'rotary-raster';
const ROTARY_RASTER_LAYER_ID = 'rotary-image';
const ROTARY_RASTER_SOURCE = 'rotary.png';
const ROTARY_RASTER_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const ROTARY_RASTER_SIDE_PX = 4;
const ROTARY_RASTER_LINES_PER_MM = 4;
const ROTARY_RASTER_LUMA_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAA==';
const ROTARY_RASTER_MIN_MM = 10;
const ROTARY_RASTER_MAX_MM = 11;
const ROTARY_MM_PER_ROTATION = 360;
const ROTARY_OBJECT_DIAMETER_MM = 60;

const ROTARY_SETUP: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: ROTARY_MM_PER_ROTATION,
  objectDiameterMm: ROTARY_OBJECT_DIAMETER_MM,
};

/** Builds the shared Save-path fixture whose raster requires Labs permission. */
export function rotaryRasterSaveProject(): Project {
  const raster: SceneObject = {
    kind: 'raster-image',
    id: ROTARY_RASTER_ID,
    color: ROTARY_RASTER_COLOR,
    source: ROTARY_RASTER_SOURCE,
    dataUrl: ROTARY_RASTER_DATA_URL,
    pixelWidth: ROTARY_RASTER_SIDE_PX,
    pixelHeight: ROTARY_RASTER_SIDE_PX,
    dither: 'floyd-steinberg',
    linesPerMm: ROTARY_RASTER_LINES_PER_MM,
    lumaBase64: ROTARY_RASTER_LUMA_BASE64,
    bounds: {
      minX: ROTARY_RASTER_MIN_MM,
      minY: ROTARY_RASTER_MIN_MM,
      maxX: ROTARY_RASTER_MAX_MM,
      maxY: ROTARY_RASTER_MAX_MM,
    },
    transform: IDENTITY_TRANSFORM,
  };
  const project = createProject({ ...DEFAULT_DEVICE_PROFILE, rotary: ROTARY_SETUP });
  return {
    ...project,
    scene: addLayer(
      addObject(project.scene, raster),
      createLayer({
        id: ROTARY_RASTER_LAYER_ID,
        color: ROTARY_RASTER_COLOR,
        mode: 'image',
      }),
    ),
  };
}
