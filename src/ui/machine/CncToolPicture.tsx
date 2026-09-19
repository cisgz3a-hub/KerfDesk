import { useState } from 'react';
import { BIT_PHOTO_ASSETS } from '../tutorials/bit-photo-assets';
import { cncBitPicture, type CncBitPicture, type CncBitPictureTool } from './cnc-bit-picture';

export function CncToolPicture(props: {
  readonly tool: CncBitPictureTool;
  readonly initiallyOpen?: boolean;
  readonly label?: string;
}): JSX.Element {
  const [open, setOpen] = useState(props.initiallyOpen ?? false);
  const picture = cncBitPicture(props.tool);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      data-cnc-tool-picture={picture.key}
      style={cardStyle}
    >
      <summary style={summaryStyle}>
        {open ? 'Hide picture' : 'Show picture'}: {props.label ?? picture.label}
      </summary>
      {open ? <PictureContent key={picture.key} picture={picture} /> : null}
    </details>
  );
}

function PictureContent(props: { readonly picture: CncBitPicture }): JSX.Element {
  const [failed, setFailed] = useState(false);
  const { picture } = props;
  const asset = BIT_PHOTO_ASSETS[picture.key];
  const base = `${import.meta.env.BASE_URL}tutorial-images/`;
  return (
    <figure style={figureStyle}>
      {failed ? (
        <span style={unavailableStyle}>
          Picture unavailable. The shape description is still shown.
        </span>
      ) : (
        <img
          src={`${base}${asset.small.file}`}
          srcSet={`${base}${asset.small.file} ${asset.small.width}w, ${base}${asset.large.file} ${asset.large.width}w`}
          sizes="128px"
          width={asset.small.width}
          height={asset.small.height}
          loading="lazy"
          decoding="async"
          alt={`Generic illustration of ${picture.label.toLowerCase()}`}
          onError={() => setFailed(true)}
          style={imageStyle}
        />
      )}
      <figcaption style={captionStyle}>
        <strong>{picture.label}</strong>
        <p style={paragraphStyle}>{picture.description}</p>
        <p style={noteStyle}>
          Generic {picture.geometryOnly === true ? 'geometry' : 'family'} illustration, not an exact
          catalog product. Match your cutter’s dimensions and flute count; the picture does not set
          them.
        </p>
      </figcaption>
    </figure>
  );
}

const cardStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  fontSize: 11,
  color: 'var(--lf-text)',
};
const summaryStyle: React.CSSProperties = {
  padding: '6px 8px',
  cursor: 'pointer',
  color: 'var(--lf-text-muted)',
};
const figureStyle: React.CSSProperties = {
  margin: 0,
  padding: '0 8px 8px',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'center',
};
const imageStyle: React.CSSProperties = {
  display: 'block',
  width: 128,
  height: 'auto',
  maxWidth: '100%',
  borderRadius: 4,
};
const captionStyle: React.CSSProperties = { flex: '1 1 150px', lineHeight: 1.45 };
const paragraphStyle: React.CSSProperties = { margin: '4px 0' };
const noteStyle: React.CSSProperties = { ...paragraphStyle, color: 'var(--lf-text-muted)' };
const unavailableStyle: React.CSSProperties = {
  width: 128,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
