// Fixed synthetic inputs, version 1. No private artwork or downloaded fixtures.
export function benchmarkSvg() {
  const paths = Array.from({ length: 50000 }, (_, i) => {
    const x = i % 250,
      y = Math.floor(i / 250);
    return `<path d="M${x} ${y}h0.7v0.7h-0.7z" fill="#000000" data-fixture="fixed-${i}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="250mm" height="200mm" viewBox="0 0 250 200">${paths.join('')}</svg>`;
}

export function benchmarkImage() {
  const size = 4096;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const disc = (x - 1200) ** 2 + (y - 1200) ** 2 < 300 ** 2;
      const ring = (x - 2850) ** 2 + (y - 2650) ** 2;
      const stripe = x > 400 && x < 3700 && y % 512 >= 250 && y % 512 < 256;
      if (disc || (ring > 400 ** 2 && ring < 440 ** 2) || stripe) {
        const pixel = (y * size + x) * 4;
        data[pixel] = 0;
        data[pixel + 1] = 0;
        data[pixel + 2] = 0;
      }
    }
  }
  return { width: size, height: size, data };
}
