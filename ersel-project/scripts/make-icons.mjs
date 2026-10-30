/**
 * Generates the Android launcher icon + splash sources in `assets/` from the
 * single brand mark in `public/brand/logo-mark.png`.
 *
 * Why a script and not hand-made files: the launcher icon must stay in sync with
 * the logo, and every Android density (mipmap-*) is derived from these 1024px
 * sources by `npx capacitor-assets generate --android`.
 *
 * Run: npm run icons:android
 */
import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const NAVY = '#0b1f45'
const NAVY_LIGHT = '#17356b'
const SOURCE = 'public/brand/logo-mark.png'

await mkdir('assets', { recursive: true })

const mark = sharp(SOURCE).png()

/** Rounded-square alpha mask, used with `dest-in` to clip the mark. */
async function roundedMask(size, radius) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** Navy field with a soft top-left glow — matches the web hero gradient. */
async function navyField(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <radialGradient id="g" cx="28%" cy="18%" r="95%">
        <stop offset="0%" stop-color="${NAVY_LIGHT}"/>
        <stop offset="55%" stop-color="${NAVY}"/>
        <stop offset="100%" stop-color="#071630"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/**
 * Soft radial fade applied to the mark before it is placed on the white badge.
 * The source artwork has a light swoosh that runs to the image border; without
 * the fade that swoosh ends in a hard rectangle. Fading the outer ring turns the
 * cut into an intentional-looking vignette.
 */
async function featherMask(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <radialGradient id="f" cx="50%" cy="50%" r="64%">
        <stop offset="62%" stop-color="#fff" stop-opacity="1"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#f)"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** The mark, scaled to `size`, feathered, then clipped to a rounded square. */
async function roundedMark(size, radius) {
  const scaled = await mark.clone().resize(size, size, { fit: 'cover' }).png().toBuffer()
  const feathered = await sharp(scaled)
    .composite([{ input: await featherMask(size), blend: 'dest-in' }])
    .png()
    .toBuffer()
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  })
    .composite([
      { input: feathered, top: 0, left: 0 },
      { input: await roundedMask(size, radius), blend: 'dest-in' }
    ])
    .png()
    .toBuffer()
}

// 1024 full-bleed icon: navy field + rounded badge carrying the mark.
const badge = await roundedMark(1024, 232)
const iconOnly = await sharp(await navyField(1024))
  .composite([{ input: badge, top: 0, left: 0 }])
  .png()
  .toBuffer()

// Adaptive foreground: transparent canvas, badge inside the 66% safe zone.
const foregroundBadge = await roundedMark(660, 150)
const foreground = await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
})
  .composite([{ input: foregroundBadge, top: 182, left: 182 }])
  .png()
  .toBuffer()

// Adaptive background: plain navy field.
const background = await sharp(await navyField(1024)).png().toBuffer()

// Splash: 2732 canvas, badge ~20% of the width, centred.
const splashBadge = await roundedMark(560, 128)
const splash = await sharp({
  create: { width: 2732, height: 2732, channels: 4, background: { r: 11, g: 31, b: 69, alpha: 1 } }
})
  .composite([{ input: splashBadge, top: 1086, left: 1086 }])
  .png()
  .toBuffer()

const files = {
  'assets/icon-only.png': iconOnly,
  'assets/icon-foreground.png': foreground,
  'assets/icon-background.png': background,
  'assets/splash.png': splash,
  'assets/splash-dark.png': splash
}

for (const [path, buffer] of Object.entries(files)) {
  await writeFile(path, buffer)
  console.log('wrote', path, buffer.length, 'bytes')
}
