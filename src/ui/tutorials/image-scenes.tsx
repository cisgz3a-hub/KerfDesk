/* eslint-disable no-restricted-syntax -- SVG illustration colours represent sample pixels/materials, not app chrome. */
import { useId } from 'react';
import {
  Arrow,
  Card,
  GOLD,
  INK,
  Label,
  Pointer,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';

type ImageKind = 'image' | 'mask' | 'trace';

export function ImageScene({
  phase,
  kind,
}: SceneProps & { readonly kind: ImageKind }): JSX.Element {
  return (
    <g>
      <rect x="38" y="53" width="188" height="162" rx="4" fill="#e0e8e6" stroke="#a7bcb8" />
      <PixelLeaf x={45} y={58} faded={kind === 'image' && phase === 0} />
      {phase === 1 ? <Pointer x={137} y={144} /> : null}
      {kind === 'mask' ? (
        <ellipse
          cx="131"
          cy="135"
          rx="69"
          ry="58"
          stroke={GOLD}
          strokeWidth="3"
          fill="none"
          strokeDasharray="5 4"
        />
      ) : null}
      <Label x={130} y={239}>
        {kind === 'image' ? 'Source pixels' : 'Original image'}
      </Label>
      <Arrow x={240} y={134} width={32} />
      {phase === 0 ? <ImageControlCard kind={kind} /> : <ImageResult phase={phase} kind={kind} />}
    </g>
  );
}

function ImageControlCard({ kind }: { readonly kind: ImageKind }): JSX.Element {
  const cards = {
    trace: {
      title: 'Trace preview',
      rows: ['Choose a trace style', 'Adjust detail', 'Inspect the result'],
    },
    mask: {
      title: 'Closed vector mask',
      rows: ['Select image + shape', 'Apply image mask', 'Crop only if needed'],
    },
    image: {
      title: 'Image controls',
      rows: ['Brightness / contrast', 'Paint / selection', 'Apply changes'],
    },
  };
  return <Card x={290} y={63} width={190} {...cards[kind]} active={0} />;
}

function ImageResult({ phase, kind }: SceneProps & { readonly kind: ImageKind }): JSX.Element {
  const clipId = `${useId()}-image-mask`;
  const captions = {
    trace: 'Editable vector paths',
    mask: 'Pixels inside the mask',
    image: 'Adjusted pixels',
  };
  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <ellipse cx="385" cy="135" rx="69" ry="58" />
        </clipPath>
      </defs>
      <rect x="292" y="53" width="188" height="162" rx="4" fill="white" stroke="#a7bcb8" />
      {kind === 'trace' ? (
        <TracedLeaf phase={phase} />
      ) : (
        <g clipPath={kind === 'mask' ? `url(#${clipId})` : undefined}>
          <PixelLeaf x={299} y={58} faded={false} />
        </g>
      )}
      {kind === 'mask' ? (
        <ellipse cx="385" cy="135" rx="69" ry="58" fill="none" stroke={TEAL} strokeWidth="2" />
      ) : null}
      <Label x={386} y={239}>
        {captions[kind]}
      </Label>
    </g>
  );
}

function TracedLeaf({ phase }: SceneProps): JSX.Element {
  return (
    <g transform="translate(310 65)" fill={TEAL_LIGHT} stroke={TEAL} strokeWidth="2.5">
      <path d="M22 110Q8 12 130 12Q141 110 22 110Z" />
      <path d="M22 110 110 32" fill="none" />
      {phase === 2
        ? [
            [22, 110],
            [130, 12],
            [110, 32],
          ].map(([x, y]) => (
            <rect key={x} x={(x ?? 0) - 3} y={(y ?? 0) - 3} width="6" height="6" fill="white" />
          ))
        : null}
    </g>
  );
}

function PixelLeaf(props: {
  readonly x: number;
  readonly y: number;
  readonly faded: boolean;
}): JSX.Element {
  return (
    <g transform={`translate(${props.x} ${props.y})`} opacity={props.faded ? 0.4 : 1}>
      {Array.from({ length: 144 }, (_, index) => {
        const x = index % 12;
        const y = Math.floor(index / 12);
        const leaf = ((x - 6) / 5) ** 2 + ((y - 5) / 4.5) ** 2 < 1 && x + y > 4;
        return (
          <rect
            key={index}
            x={x * 14}
            y={y * 12}
            width="14"
            height="12"
            fill={leaf ? ((x + y) % 3 === 0 ? '#568b67' : '#386f59') : '#f4f2e9'}
          />
        );
      })}
      <path d="M34 124 133 28" fill="none" stroke={INK} strokeWidth="2" />
    </g>
  );
}

type CameraKind = 'camera' | 'board' | 'jig' | 'print-cut';

export function CameraScene({
  phase,
  kind,
}: SceneProps & { readonly kind: CameraKind }): JSX.Element {
  if (kind === 'jig') return <RegistrationJigScene phase={phase} />;
  return (
    <g>
      <rect x="60" y="40" width="400" height="185" rx="4" fill="#e2e9e5" stroke="#9eb4b0" />
      <MaterialReference phase={phase} />
      {kind === 'camera' ? (
        <g transform="translate(37 16)">
          <rect width="38" height="24" rx="4" fill={INK} />
          <circle cx="19" cy="12" r="7" fill={TEAL_LIGHT} />
        </g>
      ) : null}
      <ReferenceMarks registered={phase === 2} />
      <Label x={260} y={257}>
        {
          [
            'Locate the physical material',
            'Match reference points and artwork',
            'Inspect placement, then Frame the exact job',
          ][phase]
        }
      </Label>
    </g>
  );
}

function RegistrationJigScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <Label x={260} y={30}>
        {
          [
            '1 · Outline only: burn the rectangle on wood',
            '2 · Place the leather keychain inside it',
            '3 · Artwork only: engrave the leather',
          ][phase]
        }
      </Label>
      <rect
        x="66"
        y="54"
        width="388"
        height="170"
        rx="4"
        fill="#d5bc91"
        stroke="#9b7d50"
        strokeWidth="2"
      />
      <path d="M80 77h68m252 0h38M80 184h57m254 0h47" fill="none" stroke="#baa076" />
      <rect x="162" y="88" width="196" height="94" fill="none" stroke="#714d2c" strokeWidth="2.5" />
      {phase > 0 ? (
        <g>
          <rect x="164" y="93" width="192" height="90" rx="15" fill="#75512f" />
          <rect
            x="164"
            y="90"
            width="192"
            height="90"
            rx="15"
            fill="#c7945d"
            stroke="#8c5a32"
            strokeWidth="2"
          />
          <rect
            x="172"
            y="98"
            width="176"
            height="74"
            rx="10"
            fill="none"
            stroke="#e8bf89"
            strokeDasharray="3 3"
          />
          <circle cx="186" cy="135" r="7" fill="#d5bc91" stroke="#85582e" strokeWidth="2" />
          {phase === 2 ? (
            <text
              x="278"
              y="146"
              textAnchor="middle"
              fontFamily="Georgia, serif"
              fontSize="30"
              fill="#4f301a"
            >
              Kai
            </text>
          ) : null}
        </g>
      ) : null}
      <Label x={260} y={211}>
        {phase === 0
          ? 'Empty wood: the leather blank is absent'
          : 'Rounded leather blank inside the rectangular outline'}
      </Label>
      <Label x={260} y={252}>
        {phase === 2
          ? 'Artwork on leather · locating outline on wood'
          : 'Fixed wood + unchanged origin = known placement'}
      </Label>
    </g>
  );
}

function MaterialReference({ phase }: SceneProps): JSX.Element {
  return (
    <g
      data-move="true"
      transform={phase === 2 ? 'translate(122 66)' : 'translate(147 48) rotate(8 130 67)'}
    >
      <rect width="270" height="134" rx="3" fill="#ead9b7" stroke="#bfa579" strokeWidth="2" />
      {phase > 0 ? (
        <text
          x="135"
          y="82"
          textAnchor="middle"
          fontFamily="Georgia, serif"
          fontSize="34"
          fill={TEAL}
        >
          Make
        </text>
      ) : null}
    </g>
  );
}

function ReferenceMarks(props: { readonly registered: boolean }): JSX.Element {
  return (
    <g>
      {[
        [122, 66],
        [392, 200],
      ].map(([x, y], i) => (
        <g
          key={i}
          transform={`translate(${x} ${y})`}
          stroke={props.registered ? TEAL : GOLD}
          strokeWidth="2"
        >
          <circle r="13" fill="white" />
          <path d="M-20 0h40M0-20v40" />
          <text x="20" y="-15" fill={INK} stroke="none" fontSize="12">
            {i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}
