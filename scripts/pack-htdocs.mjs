/**
 * Packs dist/ into ersel-htdocs.zip with index.html at the archive root.
 * Run after `npm run build`. CI does the same step inside build-apk.yml.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html مفقود. شغّل npm run build أولًا.')
  process.exit(1)
}

const scratch = join(tmpdir(), `ersel-htdocs-${Date.now()}`)
mkdirSync(scratch)
const tempZip = join(scratch, 'ersel-htdocs.zip')
execFileSync('zip', ['-r', '-q', tempZip, '.'], { cwd: 'dist', stdio: 'inherit' })
copyFileSync(tempZip, 'ersel-htdocs.zip')

const listing = execFileSync('unzip', ['-Z1', 'ersel-htdocs.zip'], { encoding: 'utf8' })
const files = listing.split('\n').filter(Boolean)
if (!files.includes('index.html')) {
  console.error('index.html ليس في جذر الحزمة.')
  process.exit(1)
}
if (!files.includes('.htaccess')) {
  console.error('.htaccess مفقود من الحزمة.')
  process.exit(1)
}
if (files.some(name => name.startsWith('dist/'))) {
  console.error('الحزمة تحتوي مجلد dist داخليًا.')
  process.exit(1)
}
console.log(`✔ ersel-htdocs.zip (${files.length} ملفًا) — index.html في الجذر.`)
