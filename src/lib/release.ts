/**
 * Where the Android build is published.
 *
 * Two ways to point at the APK, in order of precedence:
 *   1. VITE_ANDROID_APK_URL — exact link (useful for a CDN or a direct upload).
 *   2. VITE_GITHUB_REPO=owner/repo — resolves to the GitHub Releases asset named
 *      `ersel.apk`, which is what .github/workflows/build-apk.yml publishes.
 *
 * The workflow creates one release per build (`v<run_number>`) and marks it
 * "latest", so `releases/latest/download/ersel.apk` is a permanent link.
 *
 * When neither is set the UI hides the download button instead of pointing at a
 * dead link; the install sheet then offers the browser install path instead.
 */

/**
 * ✏️ اكتب هنا `اسم_المستخدم/اسم_المستودع` إن كنت تبني الموقع للنشر (استضافة)
 * وليس عبر GitHub Actions. اتركه فارغًا إذا كنت ترفع على GitHub — السير عمل
 * يضبطه تلقائيًا. المتغيّر البيئي VITE_GITHUB_REPO يتقدّم على هذه القيمة.
 */
const REPO_OVERRIDE = ''

const directUrl = (import.meta.env.VITE_ANDROID_APK_URL || '').trim()
const repo = ((import.meta.env.VITE_GITHUB_REPO || REPO_OVERRIDE) || '').trim().replace(/^\/+|\/+$/g, '')

/** Fixed asset name — the workflow always uploads the APK under this name. */
export const APK_ASSET_NAME = 'ersel.apk'

export const APK_URL = directUrl || (repo ? `https://github.com/${repo}/releases/latest/download/${APK_ASSET_NAME}` : '')

/** Releases page (for "all versions" / when the direct asset 404s). */
export const RELEASES_URL = repo ? `https://github.com/${repo}/releases` : ''

export const hasApkLink = APK_URL.length > 0

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0'

/** GitHub run number of this build; 0 for local/hosted builds. */
export const APP_BUILD = (() => {
  const parsed = Number.parseInt(typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : '0', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
})()

/** Must match minSdkVersion in the generated android project (24). */
export const ANDROID_MIN_VERSION = '7.0'

export type UpdateCheck =
  | { kind: 'newer'; build: number; url: string; notes: string }
  | { kind: 'current' }
  | { kind: 'unknown' }

type GithubRelease = {
  tag_name?: string
  body?: string
  assets?: { name?: string; browser_download_url?: string }[]
}

/**
 * Asks GitHub for the newest release and compares its build number with this
 * one. Three honest outcomes:
 *   newer   → a newer APK exists, with its direct link.
 *   current → this build is the newest.
 *   unknown → no repo configured, no build number, or the API refused the call.
 * The UI must not report "up to date" for `unknown`.
 */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!repo || APP_BUILD === 0) return { kind: 'unknown' }

  let release: GithubRelease
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' }
    })
    if (!response.ok) return { kind: 'unknown' }
    release = (await response.json()) as GithubRelease
  } catch {
    return { kind: 'unknown' }
  }

  const latest = Number.parseInt((String(release.tag_name || '').match(/\d+/) || ['0'])[0], 10)
  if (!Number.isFinite(latest) || latest <= 0) return { kind: 'unknown' }
  if (latest <= APP_BUILD) return { kind: 'current' }

  const asset = (release.assets || []).find(item => item.name === APK_ASSET_NAME)
  return {
    kind: 'newer',
    build: latest,
    url: asset?.browser_download_url || APK_URL,
    notes: String(release.body || '').replace(/\s+/g, ' ').slice(0, 240)
  }
}
