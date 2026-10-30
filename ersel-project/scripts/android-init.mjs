/**
 * Prepares a buildable Android project without committing one.
 *
 * Why this exists: a Capacitor Android folder is ~200 generated files. Keeping
 * it out of the repository means the project can be uploaded to GitHub through
 * the web UI (100 files per upload) and the native project is rebuilt by CI in
 * seconds. `android/` is therefore a build artefact, not source.
 *
 * Steps, all idempotent:
 *   1. `npx cap add android`  — only when `android/` is absent.
 *   2. Overlay `android-overlay/` on top — the handful of files we actually
 *      customise (manifest, colours, strings, status icon, gradle signing).
 *   3. Generate the notification chime (`scripts/make-sound.mjs`).
 *   4. Generate every launcher icon density (`scripts/make-icons.mjs` +
 *      `@capacitor/assets`).
 *
 * Run: npm run android:init   (CI runs it right after `npm run build`)
 */
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const isWindows = process.platform === 'win32'
const OVERLAY = 'android-overlay'
const ANDROID = 'android'

/**
 * Runs a build step. `node` is resolved to the current interpreter (so it works
 * on Windows where `node.cmd` does not exist) and only npm-style shims get the
 * `.cmd` suffix that cmd.exe requires.
 */
function run(command, args, label) {
  const isNode = command === 'node'
  const bin = isNode ? process.execPath : isWindows ? `${command}.cmd` : command
  process.stdout.write(`\n▸ ${label || `${command} ${args.join(' ')}`}\n`)
  execFileSync(bin, args, { stdio: 'inherit', shell: isWindows && !isNode })
}

/** Every file under `dir`, as full paths (nesting preserved). */
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

// 1) Native project -----------------------------------------------------------
if (existsSync(ANDROID)) {
  console.log('android/ موجود — تخطّي cap add (سيُعاد استخدامه).')
} else {
  run('npx', ['cap', 'add', 'android'], 'npx cap add android')
}

// 2) Notification chime -------------------------------------------------------
run('node', ['scripts/make-sound.mjs'], 'نغمة الإشعار (res/raw/ersel_chime.wav)')

// 3) Launcher icon + splash ---------------------------------------------------
run('node', ['scripts/make-icons.mjs'], 'أصول الأيقونة (assets/)')
run('npx', ['capacitor-assets', 'generate', '--android'], 'توليد مقاسات mipmap')

// 4) Our customisations -------------------------------------------------------
// Applied last on purpose: the generators above rewrite parts of the native
// project, so the manifest and gradle overrides must land after them to win.
if (!existsSync(OVERLAY)) {
  throw new Error(`${OVERLAY}/ غير موجود — لا يمكن تجهيز مشروع أندرويد.`)
}

const overlayFiles = (await walk(OVERLAY)).map(file => relative(OVERLAY, file))
for (const file of overlayFiles) {
  const target = join(ANDROID, file)
  await mkdir(dirname(target), { recursive: true })
  await cp(join(OVERLAY, file), target)
}
console.log(`\n✔ نُسخ ${overlayFiles.length} ملفًا من ${OVERLAY}/ فوق مشروع أندرويد.`)

// Report the artefacts a build depends on, so a missing piece fails here rather
// than 4 minutes later inside gradle with an unhelpful resource error.
const required = [
  `${ANDROID}/app/src/main/AndroidManifest.xml`,
  `${ANDROID}/app/build.gradle`,
  `${ANDROID}/app/src/main/res/raw/ersel_chime.wav`,
  `${ANDROID}/app/src/main/res/drawable/ic_stat_ersel.xml`,
  `${ANDROID}/app/src/main/res/values/colors.xml`,
  `${ANDROID}/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`
]

const missing = []
for (const file of required) {
  if (!existsSync(file)) missing.push(file)
}

if (missing.length) {
  console.error('\n✖ ملفات ناقصة:\n' + missing.map(f => `   - ${f}`).join('\n'))
  process.exit(1)
}

const { size } = await stat(`${ANDROID}/app/src/main/res/raw/ersel_chime.wav`)
console.log(`\n✔ مشروع أندرويد جاهز للبناء (الصوت: ${(size / 1024).toFixed(1)} KiB).`)
