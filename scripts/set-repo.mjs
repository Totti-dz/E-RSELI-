/**
 * Writes the GitHub repository into `src/lib/release.ts` so a **hosted** build
 * knows where to download the APK from.
 *
 * The GitHub Actions build never needs this: it injects VITE_GITHUB_REPO itself.
 * A static host (Netlify / Vercel / cPanel / GitHub Pages) has no such variable,
 * so the value has to be baked into the bundle at build time.
 *
 * Usage:
 *   node scripts/set-repo.mjs owner/repo
 *   npm run site:build -- owner/repo
 */
import { readFile, writeFile } from 'node:fs/promises'

const TARGET = 'src/lib/release.ts'
const repo = (process.argv[2] || '').trim()

if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('الاستخدام: node scripts/set-repo.mjs اسم_المستخدم/اسم_المستودع')
  console.error('مثال:        node scripts/set-repo.mjs Totti-dz/ERSEL')
  process.exit(1)
}

const source = await readFile(TARGET, 'utf8')
const pattern = /const REPO_OVERRIDE = '[^']*'/
if (!pattern.test(source)) {
  console.error(`لم أجد السطر const REPO_OVERRIDE في ${TARGET} — هل تغيّر الملف؟`)
  process.exit(1)
}

await writeFile(TARGET, source.replace(pattern, `const REPO_OVERRIDE = '${repo}'`))
console.log(`✔ REPO_OVERRIDE = '${repo}'`)
console.log(`  رابط التحميل: https://github.com/${repo}/releases/latest/download/ersel.apk`)
console.log('  الآن: npm run build')
