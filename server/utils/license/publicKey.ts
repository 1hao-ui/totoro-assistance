/**
 * **内嵌的许可证公钥**（Ed25519，SPKI PEM）—— 供应商跑 `node tools/license-keygen.ts` 时自动写入本文件。
 *
 * ## 为什么公钥可以直接提交进仓库
 * 公钥**不是秘密**：它只能**验证**签名，不能**生成**签名。泄漏它最多让人知道"验签用哪把钥匙"，
 * 无法伪造证书。所以它必须进仓库、必须被打进 EXE（否则客户端离线时无法验签）。
 * 真正的秘密是**私钥**（`tools/keys/license-private.pem`，已被 `.gitignore` 的 `*.pem` 挡住）。
 *
 * ## ⚠️ 空串 = 未配置 = **拒绝一切**
 * 初值是空串。此时 `verifyCertificate()` 返回 `no_public_key` 并**拒绝放行**（fail closed）。
 * 这一点是刻意设计的：如果空值被当成"不校验"，那么任何人只要删掉这个文件、或供应商忘了跑 keygen，
 * 整套门禁就**静默失效**了 —— 宁可"配置漏了导致用不了"（立刻暴露、能修），
 * 也不要"校验没生效导致谁都能用"（不报错、发现不了）。
 */
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAPVuJ3wteeLe/x8Dp48H7L2r8Srp0L6cYqQvV8Q9T628=
-----END PUBLIC KEY-----
`
