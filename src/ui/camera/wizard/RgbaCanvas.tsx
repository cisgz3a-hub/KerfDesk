// RgbaCanvas — paints a core RgbaImage buffer into a <canvas> at its
// intrinsic size, displayed responsive-width (the review step's A/B frames).

import { useEffect, useRef } from 'react';
import type { RgbaImage } from '../../../core/camera';

export function RgbaCanvas(props: {
  readonly image: RgbaImage;
  readonly alt: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = props.image.width;
    canvas.height = props.image.height;
    const context = canvas.getContext('2d');
    if (context === null) return;
    // The buffer is already RGBA8 row-major — a straight putImageData blit.
    context.putImageData(
      new ImageData(new Uint8ClampedArray(props.image.data), props.image.width, props.image.height),
      0,
      0,
    );
  }, [props.image]);

  return <canvas ref={canvasRef} role="img" aria-label={props.alt} style={canvasStyle} />;
}

const canvasStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--lf-bg-2)',
  borderRadius: 4,
};
