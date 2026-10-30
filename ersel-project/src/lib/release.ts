/**
 * Where the Android build is published.
 *
 * Two ways to point at the APK, in order of precedence:
 *   1. VITE_ANDROID_APK_URL — exact link (useful for a CDN or a direct upload).
 *   2. VITE_GITHUB_REPO=owner/repo — resolves to the GitHub Releases asset named
 *      `ersel.apk`, which is what .github/workflows/build-apk.yml publishes.
 *
 * The workflow keeps a single release tagged `latest` and refreshes its asset on
 * every push, so `releases/latest/download/ersel.apk` is a permanent link.
 *
 * When neither is set the UI hides the download button instead of pointing at a
 * dead link; the install sheet then offers the browser install path instead.
 */

const directUrl = (import.meta.env.VITE_ANDROID_APK_URL || '').trim()
const repo = (import.meta.env.VITE_GITHUB_REPO || '').trim().replace(/^\/+|\/+$/g, '')

/** Fixed asset name — the workflow always uploads the APK under this name. */
export const APK_ASSET_NAME = 'ersel.apk'

export const APK_URL = directUrl || (repo ? `https://github.com/${repo}/releases/latest/download/${APK_ASSET_NAME}` : '')

/** Releases page (for "all versions" / when the direct asset 404s). */
export const RELEASES_URL = repo ? `https://github.com/${repo}/releases` : ''

export const hasApkLink = APK_URL.length > 0

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0'

/** Must match minSdkVersion in android/variables.gradle (24). */
export const ANDROID_MIN_VERSION = '7.0'
