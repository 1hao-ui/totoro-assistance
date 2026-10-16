#!/usr/bin/env node
/**
 * 生成**许可证密钥对**（发布者本机跑一次）
 *
 * ```bash
 * node tools/license-keygen.ts          # 首次生成
 * node tools/license-keygen.ts --force  # 覆盖已有私钥（谨慎！）
 * ```
 *
 * 产出两个文件：
 * | 文件 | 内容 | 去处 |
 * |---|---|---|
 * | `tools/keys/license-private.pem` | 🔴 **私钥** | **只留本机**，绝不外发、绝不进 git（离线备份） |
 * | `server/utils/license/publicKey.ts` | 公钥（自动写入） | **必须进仓库**、会被打进 EXE（客户端靠它离线验签） |
 *
 * ## 两条红线
 * - 私钥**丢了** ⇒ 已发出的证书全部作废（换公钥就要重新给所有用户发证），务必离线备份；
 * - 私钥**泄漏** ⇒ 别人能自己签发证书，整套门禁失效。
 *
 * 因此覆盖已有私钥必须显式加 `--force`：默认拒绝，避免手滑把"正在给客户发证的那把钥匙"换掉。
 */
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEY_DIR = join(ROOT, 'tools', 'keys')
const PRIVATE_KEY_PATH = join(KEY_DIR, 'license-private.pem')
const PUBLIC_KEY_TS = join(ROOT, 'server', 'utils', 'license', 'publicKey.ts')
/** 公钥常量在 `publicKey.ts` 里的锚点（该常量恒为文件最后一项，替换它即可） */
const PUBKEY_MARKER = 'export const LICENSE_PUBLIC_KEY_PEM ='

const force = process.argv.includes('--force')

if (existsSync(PRIVATE_KEY_PATH) && !force) {
  console.error('')
  console.error('❌ 私钥已存在，拒绝覆盖：')
  console.error(`   ${PRIVATE_KEY_PATH}`)
  console.error('')
  console.error('   覆盖它会让**已发出的所有授权证书立刻作废**（客户端内置的公钥也会被换掉）。')
  console.error('   确实要换密钥，请先备份，再显式执行：')
  console.error('     node tools/license-keygen.ts --force')
  console.error('')
  process.exit(1)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

// ① 写私钥（0o600：尽量只给自己读写；Windows 上该位不生效，但也不会有副作用）
mkdirSync(KEY_DIR, { recursive: true })
writeFileSync(PRIVATE_KEY_PATH, privatePem, { encoding: 'utf8', mode: 0o600 })

// ② 把公钥写进源码（保留文件原有的说明注释，只换掉常量）
const src = readFileSync(PUBLIC_KEY_TS, 'utf8')
const at = src.indexOf(PUBKEY_MARKER)
if (at < 0) {
  console.error(`❌ 在 ${PUBLIC_KEY_TS} 里找不到锚点 \`${PUBKEY_MARKER}\`，无法写入公钥。`)
  console.error('   请检查该文件是否被改动过（或删掉它，本脚本会提示如何恢复）。')
  process.exit(1)
}
writeFileSync(
  PUBLIC_KEY_TS,
  `${src.slice(0, at)}${PUBKEY_MARKER} \`${publicPem.trim()}\n\`\n`,
  'utf8',
)

console.log('')
console.log('✅ 密钥对已生成')
console.log('')
console.log(`   私钥（🔴 绝不外发）: ${PRIVATE_KEY_PATH}`)
console.log(`   公钥（已嵌入源码）  : ${PUBLIC_KEY_TS}`)
console.log('')
console.log('   下一步：')
console.log('     ① 立刻把私钥**离线备份**（U 盘/密码管理器）—— 丢了就再也签不出证书；')
console.log('     ② `git status` 确认私钥**没有被加入版本控制**（tools/keys/ 已在 .gitignore 里）；')
console.log('     ③ 用户把「授权」页的机器码发给你后，执行：')
console.log('        node tools/license-issue.ts --machine <机器码> --sub "<客户名>"')
console.log('')
