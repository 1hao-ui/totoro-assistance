/**
 * **全局路由守卫**：未授权时把用户拦到「授权」页。
 *
 * ## 为什么还需要它（服务端闸门已经会返回 402 了）
 * 服务端闸门保证"未授权拿不到数据"，但**前端体验很差**：
 * 用户能正常打开工作台、看到完整的界面，然后每点一个功能就静默失败（控制台里只有 402），
 * 完全不知道自己缺的是"授权"。实测截图确认过这个现象。
 * 所以这里补一层**导航级**引导：没授权就直接送到「授权」页，并说明原因。
 *
 * ## 三条安全约定
 * ① **授权页自身永远放行** —— 否则就是"要激活请先去授权页、去授权页请先激活"的死循环；
 * ② **状态读不到就不拦** —— 接口异常时放行（交给服务端 402 兜底），绝不把用户锁在门外；
 * ③ **判据只用服务端返回的状态** —— 前端不自行推断"能不能用"，避免和服务端闸门各说各话
 *    （改前端也绕不过服务端，这正是闸门放在服务端的意义）。
 *
 * ⚠️ `shouldRedirectToLicense` 必须**显式 import**：仓库里 `utils/mp/**` 不是 Nuxt 自动导入的范围
 *    （Nuxt 只自动导入 `utils/` 顶层与 `composables/`），漏了它会在**运行时**报
 *    `shouldRedirectToLicense is not defined`，而类型检查完全发现不了 —— 这个 bug 是
 *    用无头浏览器实测抓出来的（页面直接 500、守卫彻底失效）。
 */
import { shouldRedirectToLicense } from '~/utils/mp/licensePolicy'

export default defineNuxtRouteMiddleware(async (to) => {
  // ① 授权页永远放行（防死循环）
  if (to.path === '/license') return

  const { status, ensureLoaded } = useLicenseState()
  const gotStatus = await ensureLoaded()
  // ② 读不到状态 ⇒ 放行，让服务端闸门去判断（宁可多一次 402，也不能把人锁死）
  if (!gotStatus) return

  // ③ 统一判据（`utils/mp/licensePolicy.ts`，纯函数 + 单测）
  if (shouldRedirectToLicense(status.value, to.path)) {
    return navigateTo({ path: '/license', query: { need: '1' } }, { replace: true })
  }
})
