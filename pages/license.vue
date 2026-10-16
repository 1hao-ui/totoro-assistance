<template>
  <div>
    <!-- 开发模式提示：dev 下不校验（生产构建会强制） -->
    <v-alert v-if="status.devBypass" type="info" variant="tonal" density="comfortable" class="mb-4">
      <div class="font-weight-bold">
        <v-icon class="mr-1">mdi-wrench-outline</v-icon>开发模式：授权校验已跳过
      </div>
      <div class="text-body-2">
        当前运行的是开发版（<code>npm run dev</code>），授权<b>不生效</b>；<b>打包后的正式版会强制校验</b>。
        想在本机按正式版口径自测：设环境变量 <code>TOTORO_LICENSE_STRICT=1</code> 再启动。
      </div>
    </v-alert>

    <!-- 公钥未配置：这是**发布方**的配置问题，用户做什么都没用，必须明确指出，避免用户白折腾 -->
    <v-alert v-if="!status.publicKeyConfigured" type="error" variant="tonal" density="comfortable" class="mb-4">
      <div class="font-weight-bold">
        <v-icon class="mr-1">mdi-alert-octagon-outline</v-icon>本程序尚未配置许可证公钥
      </div>
      <div class="text-body-2">
        发布者还没有执行 <code>node tools/license-keygen.ts</code>，因此<b>任何证书都无法通过校验</b>。
        请联系发布者重新打包后再试（这是打包问题，不是你操作错了）。
      </div>
    </v-alert>

    <!-- 机器码未能持久化：必须提前警告，否则用户"下次开机又要重新激活"，会以为是 bug -->
    <v-alert v-if="!status.machineCodeStable" type="warning" variant="tonal" density="comfortable" class="mb-4">
      <div class="font-weight-bold">
        <v-icon class="mr-1">mdi-content-save-alert-outline</v-icon>机器码无法持久保存
      </div>
      <div class="text-body-2">
        本机写不进授权目录（<code>{{ status.dir }}</code>），<b>下次启动机器码会变、授权将失效</b>。
        请检查该目录的写入权限，或换一个可写位置后再激活。
      </div>
    </v-alert>

    <!-- ① 当前状态 -->
    <v-card class="mb-4">
      <v-card-title class="d-flex align-center flex-wrap ga-2">
        <v-icon :color="status.licensed ? 'success' : 'warning'" class="mr-1">
          {{ status.licensed ? 'mdi-shield-check-outline' : 'mdi-shield-alert-outline' }}
        </v-icon>
        <span class="text-h6">授权状态</span>
        <v-chip :color="status.licensed ? 'success' : 'warning'" variant="tonal" size="small">
          {{ status.licensed ? '已授权' : '未授权' }}
        </v-chip>
        <v-chip v-if="status.degraded" color="warning" variant="flat" size="small">
          已到期 · 宽限期内
        </v-chip>
      </v-card-title>
      <v-card-text>
        <div class="text-body-2 mb-3">{{ status.message }}</div>

        <v-table v-if="status.licensed" density="compact">
          <tbody>
            <tr><td class="text-medium-emphasis" style="width: 140px">授权对象</td><td>{{ textOr(status.subject) }}</td></tr>
            <tr><td class="text-medium-emphasis">许可证编号</td><td>{{ textOr(status.licenseId) }}</td></tr>
            <tr><td class="text-medium-emphasis">功能位</td><td>{{ status.features.length ? status.features.join('、') : '—' }}</td></tr>
            <tr><td class="text-medium-emphasis">正常到期</td><td>{{ fmtTime(status.expiresAt) }}</td></tr>
            <tr><td class="text-medium-emphasis">离线宽限至</td><td>{{ fmtTime(status.graceUntil) }}（超过它一律拒绝）</td></tr>
            <tr><td class="text-medium-emphasis">激活时间</td><td>{{ textOr(status.activatedAt) }}</td></tr>
          </tbody>
        </v-table>

        <div class="d-flex flex-wrap ga-2 mt-4">
          <v-btn variant="tonal" size="small" prepend-icon="mdi-refresh" :loading="loading" @click="refresh">刷新状态</v-btn>
          <v-btn
            v-if="status.licensed"
            variant="tonal"
            size="small"
            color="error"
            prepend-icon="mdi-link-variant-off"
            :loading="busy"
            @click="doDeactivate"
          >
            解除本机授权
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- ② 机器码 -->
    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-1">mdi-fingerprint</v-icon>
        <span class="text-h6">本机机器码</span>
      </v-card-title>
      <v-card-text>
        <div class="text-body-2 mb-2">
          把下面这串<b>发给发布者</b>，发布者会据此为你签发一张<b>专属授权证书</b>。
          它<b>与本机绑定</b>：换一台机器就不通用，所以每台机器都要单独签发。
        </div>
        <div class="d-flex align-center flex-wrap ga-2">
          <code class="machine-code">{{ textOr(status.machineCode) }}</code>
          <v-btn variant="tonal" size="small" prepend-icon="mdi-content-copy" @click="copyMachineCode">
            复制机器码
          </v-btn>
        </div>
        <div class="text-caption text-medium-emphasis mt-2">
          数据目录：<code>{{ textOr(status.dir) }}</code>
        </div>
      </v-card-text>
    </v-card>

    <!-- ③ 激活 -->
    <v-card class="mb-4">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-1">mdi-key-variant</v-icon>
        <span class="text-h6">粘贴授权证书</span>
      </v-card-title>
      <v-card-text>
        <div class="text-body-2 mb-2">
          把发布者发给你的<b>整段证书</b>粘贴到下面 —— 换行、空格都会被自动忽略，不用担心复制多出空行。
        </div>
        <v-textarea
          v-model="certificate"
          label="授权证书"
          placeholder="粘贴形如 xxxxx.xxxxx 的一整段文本"
          rows="4"
          auto-grow
          variant="outlined"
          density="comfortable"
          hide-details
        />

        <v-alert v-if="errorText" type="error" variant="tonal" density="comfortable" class="mt-3">
          {{ errorText }}
        </v-alert>

        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn color="primary" variant="flat" prepend-icon="mdi-check-decagram" :loading="busy" @click="doActivate">
            激活
          </v-btn>
          <v-btn variant="text" :disabled="!certificate" @click="certificate = ''">清空</v-btn>
        </div>
      </v-card-text>
    </v-card>

    <!-- ④ 说明 -->
    <v-alert type="info" variant="tonal" density="comfortable">
      <div class="font-weight-bold">
        <v-icon class="mr-1">mdi-information-outline</v-icon>关于授权
      </div>
      <ul class="text-body-2 pl-4 mt-1">
        <li>证书采用<b>非对称签名</b>校验：本程序只内置<b>公钥</b>，私钥始终在发布者本机，因此<b>无法伪造</b>证书；</li>
        <li>校验完全在<b>本机</b>完成（不联网），激活一次后即可<b>离线使用</b>；正常到期后还有一段离线宽限期；</li>
        <li>请勿转发证书或公开分享本软件：证书与本机机器码绑定，转发到别的机器上<b>用不了</b>，只会白费功夫。</li>
      </ul>
    </v-alert>
  </div>
</template>

<script setup lang="ts">
/**
 * 「授权」页（2026-10-16 新增）—— 展示本机机器码 + 录入/解除授权证书。
 *
 * ## ⚠️ DTO 为什么在页面里**内联声明**，而不是从 `server/` import
 * 仓库的分层规则（`scripts/check-wiring.mjs` 的 R6-L6）明确禁止前端直接 import `server/**`：
 * 前端只能通过接口（`/api/**`）拿数据。所以这里按仓库既有做法（如 `pages/index.vue` 对
 * `/api/local/token-scan/start` 的写法）**内联声明返回结构**。
 *
 * ## 为什么状态用**非空默认值**而不是 `ref<Status | null>(null)`
 * 仓库的 R7 守卫会扫描页面模板：`| null` 的可空状态若在模板里裸取（`status.foo`）就会报违规。
 * 用"带默认值的完整对象"既避开这条守卫，也让模板不必到处写 `?.`（更不容易漏）。
 *
 * ## 本页**不做任何业务判断**
 * "能不能用"由服务端中间件决定（`server/middleware/license.ts`）。本页只负责展示与录入 ——
 * 前端说了不算，改前端也绕不过去（这正是闸门放在服务端的意义）。
 */
import { useNotice } from '~/composables/useNotice'

/** `/api/local/license/status` 的返回结构（与 `server/utils/license/state.ts` 的 `LicenseStatus` 对应） */
interface LicenseStatusDto {
  licensed: boolean
  code: string
  degraded: boolean
  message: string
  machineCode: string
  machineCodeStable: boolean
  publicKeyConfigured: boolean
  devBypass: boolean
  enforced: boolean
  subject: string
  licenseId: string
  features: string[]
  issuedAt: number
  expiresAt: number
  graceUntil: number
  activatedAt: string
  dir: string
}

const showSnackbar = useNotice()

/** 首屏默认值：字段齐全，避免模板里出现 `undefined.xxx` */
const emptyStatus = (): LicenseStatusDto => ({
  licensed: false,
  code: 'not_activated',
  degraded: false,
  message: '正在读取授权状态…',
  machineCode: '',
  machineCodeStable: true,
  publicKeyConfigured: true,
  devBypass: false,
  enforced: true,
  subject: '',
  licenseId: '',
  features: [],
  issuedAt: 0,
  expiresAt: 0,
  graceUntil: 0,
  activatedAt: '',
  dir: '',
})

const status = ref<LicenseStatusDto>(emptyStatus())
const certificate = ref('')
const loading = ref(true)
const busy = ref(false)
const errorText = ref('')

/** 空值统一显示为短横线（避免表格里出现空白单元格，看起来像没加载出来） */
const textOr = (s: string): string => (s && s.trim() ? s : '—')

/** Unix 秒 → 本地时间（0/缺失显示短横线） */
const fmtTime = (sec: number): string =>
  sec > 0 ? new Date(sec * 1000).toLocaleString('zh-CN', { hour12: false }) : '—'

/** 读状态（强制服务端重算：本接口只在进页面/点刷新时调用，代价可忽略） */
const refresh = async (): Promise<void> => {
  loading.value = true
  try {
    const res = await $fetch<{ ok: boolean; status: LicenseStatusDto }>('/api/local/license/status')
    status.value = res.status
    errorText.value = ''
  } catch (e) {
    errorText.value = `读取授权状态失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    loading.value = false
  }
}

const copyMachineCode = async (): Promise<void> => {
  if (!status.value.machineCode) {
    errorText.value = '机器码还没读出来，请先点「刷新状态」'
    return
  }
  try {
    await navigator.clipboard.writeText(status.value.machineCode)
    showSnackbar('机器码已复制，把它发给发布者即可', 'success')
  } catch {
    // 剪贴板可能被浏览器策略拒绝（非 https/无权限）⇒ 降级为"让用户手动选中复制"，不报错打断流程
    errorText.value = '无法自动复制，请手动选中上面的机器码复制'
  }
}

/** 激活：失败时把服务端返回的**具体原因**显示出来（不同原因的处理方式完全不同） */
const doActivate = async (): Promise<void> => {
  if (!certificate.value.trim()) {
    errorText.value = '请先粘贴授权证书'
    return
  }
  busy.value = true
  try {
    const res = await $fetch<{ ok: boolean; error: string; status: LicenseStatusDto }>('/api/local/license/activate', {
      method: 'POST',
      body: { certificate: certificate.value },
    })
    status.value = res.status
    if (res.ok) {
      errorText.value = ''
      certificate.value = ''
      showSnackbar('授权激活成功', 'success')
    } else {
      errorText.value = res.error
    }
  } catch (e) {
    errorText.value = `激活请求失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

const doDeactivate = async (): Promise<void> => {
  busy.value = true
  try {
    const res = await $fetch<{ ok: boolean; status: LicenseStatusDto }>('/api/local/license/deactivate', { method: 'POST' })
    status.value = res.status
    errorText.value = ''
    showSnackbar('已解除本机授权（如需再次使用请重新激活）', 'info')
  } catch (e) {
    errorText.value = `解除授权失败：${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
useHead({ title: '授权 · 龙猫天堂' })
</script>

<style scoped>
/* 机器码用等宽字体 + 大字距：用户要一个字符一个字符念给发布者，必须好认 */
.machine-code {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 1.05rem;
  letter-spacing: 0.08em;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  user-select: all;
}
</style>
