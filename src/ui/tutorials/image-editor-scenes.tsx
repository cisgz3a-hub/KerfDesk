/* eslint-disable no-restricted-syntax -- SVG illustration colours represent sample pixels/materials, not app chrome. */
import { useId } from 'react';
import {
  Card,
  GOLD,
  INK,
  Label,
  Pointer,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';
import {
  ImageCropScene,
  ImageLayersScene,
  ImageTextScene,
  ImageToneScene,
  ImageTransformScene,
} from './image-editor-document-scenes';

export type ImageEditorSceneKind =
  | 'image-paint'
  | 'image-select'
  | 'image-fill'
  | 'image-retouch'
  | 'image-crop'
  | 'image-layers'
  | 'image-transform'
  | 'image-text'
  | 'image-tone';

const SCENES: Record<ImageEditorSceneKind, (props: SceneProps) => JSX.Element> = {
  'image-paint': ImagePaintScene,
  'image-select': ImageSelectionScene,
  'image-fill': ImageFillScene,
  'image-retouch': ImageRetouchScene,
  'image-crop': ImageCropScene,
  'image-layers': ImageLayersScene,
  'image-transform': ImageTransformScene,
  'image-text': ImageTextScene,
  'image-tone': ImageToneScene,
};

export function ImageEditorScene({
  phase,
  kind,
}: SceneProps & { readonly kind: ImageEditorSceneKind }): JSX.Element {
  const Scene = SCENES[kind];
  return <Scene phase={phase} />;
}

function ImagePaintScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="53" y="50" width="275" height="168" fill="white" stroke="#b6c9c5" />
      <path d="M75 73h230m-230 28h230m-230 28h230m-230 28h230m-230 28h230" stroke="#e6eeeb" />
      {phase > 0 ? (
        <path
          d="M91 165Q126 78 172 149T286 114"
          fill="none"
          stroke={TEAL}
          strokeWidth="17"
          strokeLinecap="round"
          opacity="0.85"
        />
      ) : null}
      {phase === 2 ? (
        <path
          d="M112 191Q198 183 283 188"
          fill="none"
          stroke={TEAL}
          strokeWidth="5"
          strokeLinecap="round"
        />
      ) : null}
      {phase < 2 ? (
        <g>
          <circle
            cx={phase === 0 ? 91 : 172}
            cy={phase === 0 ? 165 : 149}
            r="14"
            fill="none"
            stroke={GOLD}
          />
          <Pointer x={phase === 0 ? 91 : 172} y={phase === 0 ? 165 : 149} />
        </g>
      ) : null}
      <Card
        x={352}
        y={52}
        width={145}
        title="Brush options"
        rows={['Size (pixels)', 'Hardness', 'Opacity', 'Foreground colour']}
        active={phase}
      />
      <Label x={260} y={253}>
        {
          [
            'Choose brush size and colour',
            'Drag to paint on the active layer',
            'Inspect the marks, then Apply',
          ][phase]
        }
      </Label>
    </g>
  );
}

function ImageSelectionScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="52" y="49" width="276" height="170" fill="#e4d4b4" stroke="#b6a47f" />
      <circle cx="132" cy="124" r="46" fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="3" />
      <path d="M212 83h74v83h-74Z" fill="#c29a66" />
      {phase > 0 ? (
        <>
          <rect x="77" y="68" width="110" height="114" fill="none" stroke="white" strokeWidth="3" />
          <rect
            x="77"
            y="68"
            width="110"
            height="114"
            fill="none"
            stroke={INK}
            strokeDasharray="5 5"
          />
        </>
      ) : null}
      {phase === 1 ? <Pointer x={187} y={182} /> : null}
      {phase === 2 ? (
        <ellipse
          cx="249"
          cy="128"
          rx="43"
          ry="49"
          fill="none"
          stroke={INK}
          strokeWidth="2"
          strokeDasharray="5 5"
        />
      ) : null}
      <Card
        x={351}
        y={55}
        width={147}
        title="Selection"
        rows={['Marquee / Lasso', 'Wand tolerance', 'Shift: add', 'Alt: subtract']}
        active={phase === 2 ? 2 : phase}
      />
      <Label x={260} y={254}>
        {
          [
            'Choose a region to isolate',
            'Drag a marquee around the subject',
            'Shift adds another selected region',
          ][phase]
        }
      </Label>
    </g>
  );
}

function ImageFillScene({ phase }: SceneProps): JSX.Element {
  const gradientId = `${useId()}-fill-gradient`;
  return (
    <g>
      <defs>
        <linearGradient id={gradientId}>
          <stop stopColor={TEAL} />
          <stop offset="1" stopColor="white" />
        </linearGradient>
      </defs>
      <rect x="48" y="53" width="424" height="166" fill="white" stroke="#b6c9c5" />
      <circle
        cx="156"
        cy="128"
        r="54"
        fill={phase > 0 ? TEAL_LIGHT : 'white'}
        stroke={INK}
        strokeWidth="3"
      />
      <rect
        x="302"
        y="76"
        width="122"
        height="104"
        fill={phase === 2 ? `url(#${gradientId})` : 'white'}
        stroke={INK}
        strokeWidth="3"
      />
      {phase === 1 ? <Pointer x={156} y={128} /> : null}
      {phase === 2 ? (
        <path d="M313 193h99m-8-5 8 5-8 5" stroke={GOLD} fill="none" strokeWidth="2" />
      ) : null}
      <Label x={156} y={206}>
        Paint bucket: click
      </Label>
      <Label x={362} y={206}>
        Gradient: drag
      </Label>
      <Label x={260} y={253}>
        {
          [
            'Choose foreground and background colours',
            'Bucket fills the clicked region',
            'Gradient blends along the drag direction',
          ][phase]
        }
      </Label>
    </g>
  );
}

function ImageRetouchScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="54" y="57" width="286" height="157" fill="#c7d5bf" stroke="#b6c9c5" />
      <path
        d="M60 82q67 23 140 0t132 0M60 112q67 23 140 0t132 0M60 142q67 23 140 0t132 0M60 172q67 23 140 0t132 0"
        fill="none"
        stroke="#a4bb9d"
        strokeWidth="9"
      />
      {phase < 2 ? (
        <g fill="#605f50">
          <circle cx="264" cy="141" r="9" />
          <circle cx="275" cy="129" r="4" />
        </g>
      ) : null}
      {phase > 0 ? (
        <g fill="none" stroke={GOLD} strokeWidth="2">
          <circle cx="127" cy="139" r="16" />
          <path d="M101 139h52m-26-26v52M152 139h86m-8-5 8 5-8 5" />
        </g>
      ) : null}
      {phase === 1 ? <Pointer x={264} y={141} /> : null}
      <Card
        x={359}
        y={69}
        width={138}
        title="Clone stamp"
        rows={['Alt-click source', 'Paint the copy', 'Inspect the edge']}
        active={phase}
      />
      <Label x={260} y={253}>
        {
          [
            'Find a clean source near the blemish',
            'Sample, then paint over the defect',
            'Check the repaired texture before Apply',
          ][phase]
        }
      </Label>
    </g>
  );
}
