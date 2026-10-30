/**
 * Synthesises the notification chime used by the Android app.
 *
 * A file is generated instead of downloading one so the repository stays
 * licence-clean (no third-party audio) and the sound can be tweaked in code.
 *
 * Output: android/app/src/main/res/raw/ersel_chime.wav
 *   PCM 16-bit mono 44.1 kHz — the format every Android version accepts for
 *   notification channels without transcoding.
 *
 * The gesture is a two-note rise (E6 → B6) with a soft attack and an
 * exponential tail, which reads as "delivered / update" without being shrill.
 *
 * Run: npm run sound:android
 */
import { mkdir, writeFile } from 'node:fs/promises'

const RATE = 44100
const DURATION = 1.15
const OUT = 'android/app/src/main/res/raw/ersel_chime.wav'

const samples = Math.round(RATE * DURATION)
const pcm = new Int16Array(samples)

/** One struck-bell note: fundamental + a quieter fifth, exponential decay. */
function addNote(startSec, freq, gain, decay) {
  const start = Math.round(startSec * RATE)
  const len = Math.round(Math.min(DURATION - startSec, 1.0) * RATE)
  for (let i = 0; i < len; i += 1) {
    const t = i / RATE
    // Fast attack (8 ms) avoids a click at the start of the note.
    const attack = Math.min(1, t / 0.008)
    const env = attack * Math.exp(-t / decay)
    const wave =
      Math.sin(2 * Math.PI * freq * t) +
      0.32 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.16 * Math.sin(2 * Math.PI * freq * 1.5 * t)
    const value = wave * env * gain
    const idx = start + i
    if (idx < samples) pcm[idx] += Math.round(Math.max(-1, Math.min(1, value)) * 32767 * 0.9)
  }
}

addNote(0.0, 1318.51, 0.62, 0.20) // E6
addNote(0.13, 1975.53, 0.46, 0.30) // B6

// 40 ms fade-out on the tail so the file never ends on a step.
const fade = Math.round(0.04 * RATE)
for (let i = 0; i < fade; i += 1) {
  const idx = samples - fade + i
  pcm[idx] = Math.round(pcm[idx] * (1 - i / fade))
}

const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length * 2, 4)
header.write('WAVE', 8)
header.write('fmt ', 12)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20) // PCM
header.writeUInt16LE(1, 22) // mono
header.writeUInt32LE(RATE, 24)
header.writeUInt32LE(RATE * 2, 28)
header.writeUInt16LE(2, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length * 2, 40)

await mkdir('android/app/src/main/res/raw', { recursive: true })
await writeFile(OUT, Buffer.concat([header, Buffer.from(pcm.buffer)]))
console.log('wrote', OUT, (44 + pcm.length * 2) / 1024, 'KiB')
