/**
 * 授权状态的**前端唯一缓存**（路由守卫 / 顶栏 / 授权页三处共用）。
 *
 * ## 为什么要有它
 * 同一个授权状态要被三个地方读：
 *   · `middleware/license-guard.global.ts` —— 决定"该不该把用户拦到授权页"；
 *   · `layouts/default.vue` —— 顶栏那个状态 chip；
 *   · `pages/license.vue` —— 授权页本身。
 * 如果三处各自 `$fetch` 一遍，就会出现"顶栏已授权、页面还在拦"这类自相矛盾（且白打三次接口）。
 * 所以状态只在这里读一次、存进 Nuxt 的 `useState`（跨组件/跨路由同一个引用），其余地方只读。
 *
 * ## 缓存策略
 * `ensureLoaded()` 是给路由守卫用的：**已读过就直接返回缓存**，不重复打接口
 * （否则用户每点一次导航就多一次请求）。激活/解绑成功后由页面调 `applyStatus()` 写回最新值。
 * 「刷新状态」按钮走 `refresh()` 强制重读。
 */
import { deriveLicenseUi, emptyLicenseStatus, type LicenseStatusView } from '~/utils/mp/licensePolicy'
import type { LicenseUiState } from '~/utils/mp/licensePolicy'

/** `/api/local/license/status` 的响应形状 */
export interface LicenseStatusResponse {
  ok: boolean
  status: LicenseStatusView
}

export function useLicenseState() {
  /** 跨路由共享：同一个 key 在任意组件里拿到的是**同一个** ref */
  const status = useState<LicenseStatusView>('license:status', emptyLicenseStatus)
  const loaded = useState<boolean>('license:loaded', () => false)
  const loading = useState<boolean>('license:loading', () => false)
  const lastError = useState<string>('license:lastError', () => '')

  /** 由状态推导出的界面语义（chip 文案/颜色、是否拦截、横幅）—— 判据全部在 `utils/mp/licensePolicy.ts` */
  const ui = computed<LicenseUiState>(() => deriveLicenseUi(status.value))

  /**
   * 强制重读服务端状态。
   * @returns 是否**成功拿到**状态（false = 网络/接口异常，调用方据此决定"不要拦人"）
   */
  async function refresh(): Promise<boolean> {
    loading.value = true
    try {
      const res = await $fetch<LicenseStatusResponse>('/api/local/license/status')
      status.value = res.status
      loaded.value = true
      lastError.value = ''
      return true
    } catch (e) {
      // ⚠️ 这里**只记错误、不抛**：授权状态读不到时，宁可"放行让服务端自己去拦"，
      //    也绝不能让前端因为读不到状态而把用户锁死在授权页外面（那是自锁死循环）。
      lastError.value = `读取授权状态失败：${e instanceof Error ? e.message : String(e)}`
      return false
    } finally {
      loading.value = false
    }
  }

  /** 首次使用才读；已读过直接用缓存（路由守卫每次导航都会调它） */
  async function ensureLoaded(): Promise<boolean> {
    if (loaded.value) return true
    return refresh()
  }

  /** 激活 / 解绑成功后，把服务端返回的最新状态写回共享缓存 */
  function applyStatus(next: LicenseStatusView): void {
    status.value = next
    loaded.value = true
    lastError.value = ''
  }

  /** 让缓存失效（下次 ensureLoaded 会重新读） */
  function invalidate(): void {
    loaded.value = false
  }

  return { status, ui, loaded, loading, lastError, refresh, ensureLoaded, applyStatus, invalidate }
}
