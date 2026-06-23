// One-shot icon generator: SVG -> 256/512 PNG + multi-res ICO.
// Run: npm i -D sharp png-to-ico && node build/make-icons.cjs
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const SRC = path.join(__dirname, 'icon.svg');
const OUT_PNG_512 = path.join(__dirname, 'icon.png');
const OUT_PNG_256 = path.join(__dirname, 'icon-256.png');
const OUT_ICO = path.join(__dirname, 'icon.ico');

async function main() {
  const svg = fs.readFileSync(SRC);
  await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(OUT_PNG_512);
  await sharp(svg, { density: 384 }).resize(256, 256).png().toFile(OUT_PNG_256);

  const buf = await pngToIco([OUT_PNG_256, OUT_PNG_512]);
  fs.writeFileSync(OUT_ICO, buf);

  console.log('Wrote:\n', OUT_PNG_512, '\n', OUT_PNG_256, '\n', OUT_ICO);
}

main().catch((e) => { console.error(e); process.exit(1); });
