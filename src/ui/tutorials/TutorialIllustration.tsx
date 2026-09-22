/* eslint-disable no-restricted-syntax -- Fixed SVG illustration colours represent sample artwork and materials, not application chrome. */
import { useId } from 'react';
import {
  CornerScene,
  DogboneScene,
  MeasureScene,
  NodeScene,
  SelectScene,
  ShapeScene,
  TextScene,
} from './geometry-scenes';
import { ArrangeScene, BooleanScene } from './layout-scenes';
import { ImageEditorScene } from './image-editor-scenes';
import { VariableTextScene } from './variable-text-scenes';
import { BoxFitScene, CncInlayScene, CncTilingScene } from './production-example-scenes';
import { IntervalTestScene, ProbeScene, ScanOffsetScene } from './calibration-scenes';
import { CameraScene, ImageScene } from './image-scenes';
import { ProjectFileScene, ProjectNotesScene, WorkspaceBasicsScene } from './project-scenes';
import {
  CutScene,
  DrillScene,
  MachineScene,
  ReliefScene,
  RotaryScene,
  VCarveScene,
} from './machining-scenes';
import {
  BoxScene,
  CalibrationScene,
  CodeScene,
  ImportScene,
  LayersScene,
  LibraryScene,
  PreviewScene,
  SettingsScene,
  WorkspaceScene,
} from './workflow-scenes';
import type { SceneProps } from './illustration-primitives';
import type { TutorialVisual } from './tutorial-types';

const SCENES: Record<TutorialVisual, (props: SceneProps) => JSX.Element> = {
  workspace: WorkspaceScene,
  'workspace-basics': WorkspaceBasicsScene,
  'project-file': ProjectFileScene,
  'project-notes': ProjectNotesScene,
  import: ImportScene,
  select: SelectScene,
  nodes: NodeScene,
  measure: MeasureScene,
  rectangle: (p) => <ShapeScene {...p} kind="rectangle" />,
  ellipse: (p) => <ShapeScene {...p} kind="ellipse" />,
  circle: (p) => <ShapeScene {...p} kind="circle" />,
  arc: (p) => <ShapeScene {...p} kind="arc" />,
  polygon: (p) => <ShapeScene {...p} kind="polygon" />,
  star: (p) => <ShapeScene {...p} kind="star" />,
  line: (p) => <ShapeScene {...p} kind="line" />,
  polyline: (p) => <ShapeScene {...p} kind="polyline" />,
  text: TextScene,
  'text-path': (p) => <TextScene {...p} curved />,
  'variable-text': VariableTextScene,
  align: (p) => <ArrangeScene {...p} kind="align" />,
  distribute: (p) => <ArrangeScene {...p} kind="distribute" />,
  array: (p) => <ArrangeScene {...p} kind="array" />,
  nest: (p) => <ArrangeScene {...p} kind="nest" />,
  weld: (p) => <BooleanScene {...p} kind="weld" />,
  subtract: (p) => <BooleanScene {...p} kind="subtract" />,
  intersect: (p) => <BooleanScene {...p} kind="intersect" />,
  exclude: (p) => <BooleanScene {...p} kind="exclude" />,
  offset: (p) => <CornerScene {...p} kind="offset" />,
  fillet: (p) => <CornerScene {...p} kind="fillet" />,
  dogbone: DogboneScene,
  trim: (p) => <CornerScene {...p} kind="trim" />,
  image: (p) => <ImageScene {...p} kind="image" />,
  'image-paint': (p) => <ImageEditorScene {...p} kind="image-paint" />,
  'image-select': (p) => <ImageEditorScene {...p} kind="image-select" />,
  'image-fill': (p) => <ImageEditorScene {...p} kind="image-fill" />,
  'image-retouch': (p) => <ImageEditorScene {...p} kind="image-retouch" />,
  'image-crop': (p) => <ImageEditorScene {...p} kind="image-crop" />,
  'image-layers': (p) => <ImageEditorScene {...p} kind="image-layers" />,
  'image-transform': (p) => <ImageEditorScene {...p} kind="image-transform" />,
  'image-text': (p) => <ImageEditorScene {...p} kind="image-text" />,
  'image-tone': (p) => <ImageEditorScene {...p} kind="image-tone" />,
  mask: (p) => <ImageScene {...p} kind="mask" />,
  trace: (p) => <ImageScene {...p} kind="trace" />,
  layers: LayersScene,
  'laser-line': (p) => <CutScene {...p} kind="laser-line" />,
  'laser-fill': (p) => <CutScene {...p} kind="laser-fill" />,
  raster: (p) => <CutScene {...p} kind="raster" />,
  profile: (p) => <CutScene {...p} kind="profile" />,
  engrave: (p) => <CutScene {...p} kind="engrave" />,
  pocket: (p) => <CutScene {...p} kind="pocket" />,
  tabs: (p) => <CutScene {...p} kind="tabs" />,
  vcarve: VCarveScene,
  drill: DrillScene,
  relief: ReliefScene,
  machine: (p) => <MachineScene {...p} kind="machine" />,
  origin: (p) => <MachineScene {...p} kind="origin" />,
  probe: ProbeScene,
  frame: (p) => <MachineScene {...p} kind="frame" />,
  preview: PreviewScene,
  gcode: CodeScene,
  camera: (p) => <CameraScene {...p} kind="camera" />,
  jig: (p) => <CameraScene {...p} kind="jig" />,
  board: (p) => <CameraScene {...p} kind="board" />,
  'print-cut': (p) => <CameraScene {...p} kind="print-cut" />,
  rotary: RotaryScene,
  box: BoxScene,
  'box-fit': BoxFitScene,
  'cnc-tiling': CncTilingScene,
  'cnc-inlay': CncInlayScene,
  calibration: CalibrationScene,
  'scan-offset': ScanOffsetScene,
  'interval-test': IntervalTestScene,
  library: LibraryScene,
  settings: SettingsScene,
  history: (p) => <SettingsScene {...p} history />,
  console: (p) => <CodeScene {...p} consoleMode />,
};

export function TutorialIllustration(props: {
  readonly visual: TutorialVisual;
  readonly phase: number;
  readonly focus: string;
}): JSX.Element {
  const id = useId();
  const Scene = SCENES[props.visual];
  return (
    <svg
      className="lf-learn-scene"
      viewBox="0 0 520 280"
      role="img"
      aria-labelledby={`${id}-title ${id}-desc`}
    >
      <title id={`${id}-title`}>{props.focus}</title>
      <desc id={`${id}-desc`}>
        {['Before', 'Action', 'Result'][props.phase]} stage of an illustrated{' '}
        {props.visual.replaceAll('-', ' ')} example. This is sample artwork, separate from your
        project.
      </desc>
      <defs>
        <pattern id={`${id}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M20 0H0V20" fill="none" stroke="#e2eae7" strokeWidth="0.7" />
        </pattern>
      </defs>
      <rect width="520" height="280" fill="#f5f8f6" />
      <rect width="520" height="280" fill={`url(#${id}-grid)`} />
      <Scene phase={props.phase} />
    </svg>
  );
}
