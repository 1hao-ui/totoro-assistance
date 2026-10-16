/**
 * 授权**闸门判定**单测（2026-10-16）
 *
 * 为什么值得单测：这段判定是"未授权用户能否拿到核心能力"的**唯一开关**。
 * 它最危险的失效形态不是报错，而是**静默放行**：
 * ```
 *   GET /api/local/license/../../mp/getData
 * ```
 * 若只按"是否以 `/api/local/license/` 开头"判放行，这条会被当成"授权接口"放过，
 * 再被路由归一化后分发到**真正的业务处理器** —— 未授权用户直接拿到 `/api/mp/**` 的能力。
 * 下面把这类绕过逐条钉死（它们都是**归一化之后**必须判为"需要授权"的）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decideLicenseGate,
  isLicenseExemptPath,
  LICENSE_EXEMPT_PREFIX,
  normalizeLicensePath,
} from '../../server/utils/license/gate.ts'

test('非 /api/ 请求一律放行（否则未授权用户连「授权」页都打不开）', () => {
  for (const p of ['/', '/license', '/version-info', '/_nuxt/entry.js', '/logo.ico', '', '/favicon.ico?v=2']) {
    const d = decideLicenseGate(p)
    assert.equal(d.needsLicense, false, `应放行：${JSON.stringify(p)}`)
    assert.equal(d.reason, 'not-api')
  }
})

test('授权自身的接口放行（拦了就会自锁，永远激活不了）', () => {
  for (const p of [
    '/api/local/license/status',
    '/api/local/license/activate',
    '/api/local/license/deactivate',
    '/api/local/license',
    '/api/local/license/',
  ]) {
    const d = decideLicenseGate(p)
    assert.equal(d.needsLicense, false, `应放行：${p}`)
    assert.equal(d.reason, 'license-endpoint')
  }
})

test('业务接口全部需要授权', () => {
  for (const p of [
    '/api/mp/wxxcx/sunrun/getData',
    '/api/local/logs/tail',
    '/api/local/token-scan/start',
    '/api/local/run/submit/start',
    '/api/local/diagnostics/export',
    '/api/local/mornsign-submit',
  ]) {
    const d = decideLicenseGate(p)
    assert.equal(d.needsLicense, true, `必须拦：${p}`)
    assert.equal(d.reason, 'api')
  }
})

test('🔒 路径穿越绕过：归一化之后仍是业务接口 ⇒ 必须拦（不能因为"看着像授权接口"就放过）', () => {
  const bypasses = [
    '/api/local/license/../../mp/wxxcx/sunrun/getData',
    '/api/local/license/../local/logs/tail',
    '/api/local/license/../../local/run/submit/start',
    '/api/local/license/%2e%2e/%2e%2e/mp/x',
    '/api/local/license/..%2f..%2fmp/x',
    '/api/local/license/a/../../../../api/mp/x',
    '/api/local/license/./../../mp/x',
  ]
  for (const p of bypasses) {
    const d = decideLicenseGate(p)
    assert.equal(d.needsLicense, true, `穿越路径必须判为需要授权：${p} → ${d.path}`)
  }
  // 反向确认：这些路径归一化后确实是业务接口，而不是被误规整成授权接口
  assert.equal(normalizeLicensePath('/api/local/license/../../mp/x'), '/api/mp/x')
  assert.equal(normalizeLicensePath('/api/local/license/%2e%2e/%2e%2e/mp/x'), '/api/mp/x')
})

test('前缀"沾边"不能误放行：/api/local/licenseX 不是授权接口', () => {
  const d = decideLicenseGate('/api/local/licenseX/status')
  assert.equal(d.needsLicense, true, '`licenseX` 与 `license` 是不同接口，不能因为前缀相同就放行')
  assert.equal(isLicenseExemptPath('/api/local/licenseX'), false)
  // 精确匹配与尾斜杠两种形态都要能放行
  assert.equal(isLicenseExemptPath(LICENSE_EXEMPT_PREFIX), true)
  assert.equal(isLicenseExemptPath(`${LICENSE_EXEMPT_PREFIX}/status`), true)
})

test('归一化：折叠 . 与 ..、去掉空段与尾斜杠，恒以 / 开头', () => {
  assert.equal(normalizeLicensePath('/'), '/')
  assert.equal(normalizeLicensePath(''), '/')
  assert.equal(normalizeLicensePath('/a/'), '/a')
  assert.equal(normalizeLicensePath('/a//b///c'), '/a/b/c')
  assert.equal(normalizeLicensePath('/a/./b'), '/a/b')
  assert.equal(normalizeLicensePath('/a/b/../c'), '/a/c')
  assert.equal(normalizeLicensePath('/a/../../b'), '/b', '.. 越出根目录不应产出负数层级')
  assert.equal(normalizeLicensePath('/a%20b/c'), '/a b/c', '百分号转义应被解码')
})

test('非法百分号转义不猜测意图：保留原串，且仍归入"需要授权"', () => {
  // `%zz` 解不开 ⇒ 保留原串。它不再像授权接口（`%2e` 不会被解释成 `.`），因此必须拦
  const d = decideLicenseGate('/api/local/license/%zz/../../mp/x')
  assert.equal(d.needsLicense, true, '解不开的转义必须保守判为需要授权')
  assert.equal(normalizeLicensePath('/a/%zz'), '/a/%zz')
})

test('判定结果带上归一化路径，便于排查（与实际路由匹配的形态一致）', () => {
  assert.equal(decideLicenseGate('/api/mp//x/.').path, '/api/mp/x')
  assert.equal(decideLicenseGate('/api/local/license/../license/status').path, '/api/local/license/status')
  assert.equal(decideLicenseGate('/api/local/license/../license/status').needsLicense, false)
})

test('undefined / null / 异常输入不崩溃（保守方向：不误放行业务接口）', () => {
  for (const bad of [undefined, null, 123, {}]) {
    const d = decideLicenseGate(bad)
    assert.equal(typeof d.needsLicense, 'boolean')
    assert.ok(d.path.startsWith('/'))
  }
})
