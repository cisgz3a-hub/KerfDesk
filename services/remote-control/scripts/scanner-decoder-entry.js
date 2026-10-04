import { binarize, Decoder, Detector, grayscale } from '@nuintun/qrcode';

/** Pixel-only adapter. Images, pairing values and decoded text never leave the page. */
export default function decodeQr(data, width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 960 ||
    height > 960 ||
    !(data instanceof Uint8ClampedArray) ||
    data.length !== width * height * 4
  )
    return null;
  const matrix = binarize(grayscale({ data, width, height }), width, height);
  const detector = new Detector();
  const decoder = new Decoder();
  const read = () => {
    const candidates = detector.detect(matrix);
    let current = candidates.next();
    for (let count = 0; count < 8 && !current.done; count++) {
      try {
        const content = decoder.decode(current.value.matrix).content;
        if (content.length > 0 && content.length <= 1024) return { data: content };
      } catch {
        // A possible finder-pattern combination need not be a valid QR code.
      }
      current = candidates.next(false);
    }
    candidates.return();
    return null;
  };
  const normal = read();
  if (normal) return normal;
  matrix.flip();
  return read();
}
