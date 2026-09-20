/* eslint-disable no-restricted-syntax -- SVG illustration colours represent sample pixels/materials, not app chrome. */
import { useId } from 'react';
import {
  Arrow,
  Card,
  GOLD,
  Handles,
  INK,
  Label,
  MUTED,
  Pointer,
  TEAL,
  TEAL_LIGHT,
  type SceneProps,
} from './illustration-primitives';

export function ImageCropScene({ phase }: SceneProps): JSX.Element {
  const clipId = `${useId()}-crop-preview`;
  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x="129" y="66" width="217" height="137" />
        </clipPath>
      </defs>
      <g clipPath={phase === 2 ? `url(#${clipId})` : undefined}>
        <rect x="63" y="43" width="390" height="179" fill="#e4eadf" stroke={MUTED} />
        <path d="M64 203 166 75 281 183 366 106 453 211V222H64Z" fill="#91bca6" />
        <circle cx="307" cy="90" r="19" fill="#dfbb71" />
      </g>
      {phase > 0 ? <Handles x={129} y={66} w={217} h={137} /> : null}
      {phase === 1 ? <Pointer x={346} y={203} /> : null}
      {phase === 2 ? (
        <>
          <path d="M129 218h217m-217-5v10m217-10v10" stroke={GOLD} />
          <Label x={238} y={237}>
            Same pixel density · smaller extent
          </Label>
        </>
      ) : null}
      <Label x={260} y={phase === 2 ? 267 : 253}>
        {
          [
            'Decide what must stay in the image',
            'Drag a crop box, then Enter to commit',
            'Apply the cropped image to the project',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function ImageLayersScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="48" y="106" width="215" height="115" fill="#e8ddc6" stroke="#b5a587" />
      <path d="M70 201 122 137 205 201Z" fill="#91bca6" />
      {phase > 0 ? (
        <g transform="translate(23 -28)">
          <rect
            x="48"
            y="106"
            width="215"
            height="115"
            fill="white"
            fillOpacity="0.45"
            stroke={TEAL}
            strokeDasharray="5 4"
          />
          <path
            d="M105 174q33-50 86 0"
            fill="none"
            stroke={TEAL}
            strokeWidth="10"
            strokeLinecap="round"
          />
        </g>
      ) : null}
      {phase === 2 ? (
        <g transform="translate(44 -55)">
          <rect
            x="48"
            y="106"
            width="215"
            height="115"
            fill="white"
            fillOpacity="0.45"
            stroke={GOLD}
            strokeDasharray="5 4"
          />
          <text x="155" y="164" textAnchor="middle" fontSize="31" fill={INK}>
            Make
          </text>
        </g>
      ) : null}
      <Card
        x={342}
        y={50}
        width={153}
        title="Studio Layers"
        rows={
          phase === 0
            ? ['Background', '+ Add layer', 'Choose active layer']
            : ['Text layer', 'Paint layer', 'Background', 'Opacity / visibility']
        }
        active={phase === 1 ? 1 : 0}
      />
      <Label x={260} y={255}>
        {
          [
            'Start with the background image',
            'Paint on a transparent layer above it',
            'Apply combines the visible image layers',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function ImageTransformScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="53" y="55" width="264" height="157" fill="white" stroke={MUTED} />
      <g transform={phase === 0 ? 'translate(85 90)' : 'translate(144 78)'}>
        <rect width="101" height="91" fill={TEAL_LIGHT} stroke={TEAL} />
        <path d="M12 75 47 17 87 75Z" fill={TEAL} />
        <Handles x={-5} y={-5} w={111} h={101} />
      </g>
      {phase === 1 ? (
        <>
          <Arrow x={102} y={196} width={71} />
          <Pointer x={245} y={169} />
        </>
      ) : null}
      <Card
        x={342}
        y={51}
        width={155}
        title="Image Size"
        rows={['Width / Height (px)', 'Constrain proportions', 'Same workspace size', 'OK → Apply']}
        active={phase}
      />
      <Label x={260} y={253}>
        {
          [
            'Select pixels for Move or Ctrl+T',
            'Transform, then Enter to commit',
            'Image Size changes density, not millimetres',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function ImageTextScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="48" y="58" width="265" height="157" fill="#e8ddc6" stroke={MUTED} />
      <path d="M61 198 123 115 181 177 243 100 300 198Z" fill="#91bca6" />
      {phase > 0 ? (
        <text
          x="179"
          y="153"
          textAnchor="middle"
          fontSize="45"
          fontFamily="Georgia, serif"
          fill={INK}
        >
          Make
        </text>
      ) : null}
      {phase === 2 ? <Handles x={111} y={110} w={139} h={57} /> : null}
      <Card
        x={338}
        y={50}
        width={161}
        title={phase < 2 ? 'Add text' : 'Studio Layers'}
        rows={
          phase < 2
            ? ['Type the words', 'Font · Size (px)', 'Ink: black or white', 'OK: add pixel layer']
            : ['Text pixels (active)', 'Background image', 'Move / Ctrl+T', 'Apply to project']
        }
        active={phase < 2 ? phase : 0}
      />
      <Label x={260} y={252}>
        {
          [
            'Type and choose the font and pixel size',
            'OK rasterises the lettering on a new layer',
            'Position the pixel layer, then Apply',
          ][phase]
        }
      </Label>
    </g>
  );
}

export function ImageToneScene({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      <rect x="57" y="49" width="253" height="166" fill="white" stroke={MUTED} />
      <ToneSwatches phase={phase} />
      <path d="M78 176H286M78 176V65" fill="none" stroke={INK} />
      <path d="M78 176 286 65" fill="none" stroke={MUTED} strokeDasharray="4 4" />
      {phase > 0 ? (
        <path d="M78 176C156 176 191 65 286 65" fill="none" stroke={TEAL} strokeWidth="3" />
      ) : null}
      {phase === 1 ? (
        <>
          <circle cx="181" cy="123" r="5" fill="white" stroke={TEAL} />
          <Pointer x={181} y={123} />
        </>
      ) : null}
      <Card
        x={335}
        y={50}
        width={166}
        title="Curves / Adjust"
        rows={[
          'Change a small amount',
          'Toggle Preview',
          'OK: keep session edit',
          'Apply: update project',
        ]}
        active={phase === 2 ? 3 : phase}
      />
      <Label x={260} y={254}>
        {
          [
            'Choose the tonal change you need',
            'Compare the adjusted preview',
            'OK keeps the edit; Apply commits the image',
          ][phase]
        }
      </Label>
    </g>
  );
}

function ToneSwatches({ phase }: SceneProps): JSX.Element {
  return (
    <g>
      {[0, 1, 2, 3, 4].map((index) => {
        const tone = phase > 0 ? 240 - index * 53 : 201 - index * 23;
        return (
          <rect
            key={index}
            x={79 + index * 41}
            y="184"
            width="38"
            height="17"
            fill={`rgb(${tone},${tone},${tone})`}
          />
        );
      })}
    </g>
  );
}
