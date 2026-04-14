import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pngPath = path.join(root, 'public', 'icon.png');
const outDir = path.join(root, 'build');
const icoPath = path.join(outDir, 'icon.ico');

if (!fs.existsSync(pngPath)) {
  console.error('Missing', pngPath);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const buf = await pngToIco(pngPath);
fs.writeFileSync(icoPath, buf);
console.log('Wrote', icoPath);
