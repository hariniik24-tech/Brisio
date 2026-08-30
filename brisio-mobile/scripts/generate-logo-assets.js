const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const imagesDir = path.join(__dirname, '..', 'assets', 'images');
const source = fs.readFileSync(path.join(imagesDir, 'brisio-logo-mark.svg'));
const blue = '#2D66A8';

async function renderColor(name, size, background) {
  let image = sharp(source).resize(size, size);
  if (background) {
    image = image.flatten({ background });
  }
  await image.png().toFile(path.join(imagesDir, name));
}

async function renderMonochrome(name, size) {
  const alpha = await sharp(source)
    .resize(size, size)
    .ensureAlpha()
    .extractChannel('alpha')
    .toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: '#FFFFFF',
    },
  })
    .joinChannel(alpha)
    .png()
    .toFile(path.join(imagesDir, name));
}

async function main() {
  await Promise.all([
    renderColor('icon.png', 1024, blue),
    renderColor('splash-icon.png', 1024),
    renderColor('android-icon-foreground.png', 1024),
    renderColor('favicon.png', 48, blue),
    renderMonochrome('android-icon-monochrome.png', 432),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});