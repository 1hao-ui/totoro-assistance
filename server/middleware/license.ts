/**
 * **授权闸门**（Nitro 全局中间件）—— 未授权时拦住全部业务接口。
 *
 * ## 为什么闸门放在**服务端**而不是前端
 * 前端只是"把按钮藏起来"：用户按 F12 改一下、或直接 `curl` 打接口，照样能用。
 * 真正的价值（读取校园跑数据、代提交成绩）全在 `/api/**` 后面 ⇒ 闸门必须守在服务端。
 * 配上前端「授权」页只负责**展示与录入**，两边职责不混。
 *
 * ## 放行规则（三档，判定实现在 `server/utils/license/gate.ts`）
 * ① **非 `/api/` 一律放行**：静态资源与页面外壳必须能加载 —— 否则未授权用户连「授权」页都打不开，
 *    会卡成"一片空白/一直转圈"，根本没法激活（这是最容易写错的地方）；
 * ② **`/api/local/license` 放行**：授权自身的接口（查状态 / 激活 / 解绑）。若把激活接口也拦了，
 *    就永远激活不了 —— 是个自锁死循环；
 * ③ 其余 `/api/**`：**必须有有效授权**（或处于 dev 绕过）。
 *
 * ## ⚠️ 为什么判定不写在本文件里
 * 原始请求路径与路由**归一化后**的路径可能不一致：
 * `/api/local/license/../../mp/xxx` 归一化后就是真正的业务接口，只看前缀会被绕过。
 * 所以判定集中在 `gate.ts`（解码 + 折叠 `.`/`..` + 精确前缀），
 * 并由 `tests/mp/licenseGate.test.ts` 逐条钉住（含上述绕过用例）。
 *
 * ## 生产 / 开发口径
 * `state.ts` 的 `LICENSE_ENFORCED`：生产构建恒为 true；`npm run dev` 默认放行（否则开发时没法自测），
 * 想在本机按生产口径验证，设 `TOTORO_LICENSE_STRICT=1`。
 */
import { createError, defineEventHandler } from 'h3'
import { decideLicenseGate, pathnameOf } from '../utils/license/gate'
import { getLicenseStatus } from '../utils/license/state'
import { logWarn } from '../utils/logger'

/** dev 绕过只提示一次（避免每个请求刷一条日志） */
let devBypassLogged = false

export default defineEventHandler((event) => {
  const decision = decideLicenseGate(pathnameOf(event))
  // ① 非接口请求（页面/静态资源）与 ② 授权自身的接口 ⇒ 放行
  if (!decision.needsLicense) return

  const status = getLicenseStatus()
  // ③ 有有效授权 ⇒ 放行
  if (status.licensed) return

  // ③-b 开发模式放行（只记一次日志；生产构建里 devBypass 恒为 false）
  if (status.devBypass) {
    if (!devBypassLogged) {
      devBypassLogged = true
      logWarn('license', '开发模式：授权校验被跳过（生产构建会强制校验；设 TOTORO_LICENSE_STRICT=1 可按生产口径自测）', {
        code: status.code,
      })
    }
    return
  }

  /**
   * 402 Payment Required —— 语义上正是"需要授权"。
   * `data` 里带上机器码与判定码：前端可据此直接渲染"把机器码发给发布者"的引导，
   * 用户即使直接打接口也能看懂原因，不用去翻日志。
   */
  throw createError({
    statusCode: 402,
    statusMessage: 'LICENSE_REQUIRED',
    message: status.message,
    data: {
      code: status.code,
      machineCode: status.machineCode,
      publicKeyConfigured: status.publicKeyConfigured,
    },
  })
})
