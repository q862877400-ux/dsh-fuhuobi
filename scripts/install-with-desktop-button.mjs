#!/usr/bin/env node
/**
 * dsh-plugin-guard 增量：一键安装 + 桌面回滚按钮自动生成
 *
 * 用法：
 *   node scripts/install-with-desktop-button.mjs [--profile web] [--pkg <spec>] [--home <DSH_HOME>]
 *     --pkg 可选：guard 安装 spec（tgz URL / npm 包名 / 本地目录）。不传则假设已安装。
 *     --home 可选：DSH_HOME（默认 ~/.dsh）。
 *
 * 行为：
 *   1) 若 --pkg 且 guard 未安装 → dsh plugin --profile <X> add <spec>
 *   2) 定位 guard CLI：<DSH_HOME>/profiles/<profile>/node_modules/dsh-plugin-guard/scripts/guard-cli.js
 *   3) 读桌面路径（注册表 Shell Folders\Desktop，处理 OneDrive；读不到回退 %USERPROFILE%\Desktop；再不行回退当前工作目录）
 *   4) 生成固定名按钮「DSH插件回滚.cmd」（覆盖式，桌面上永远只有一个）
 *   5) 幂等：重复运行只更新按钮，不重复安装。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, dirname } from 'node:path'

const isWin = platform() === "win32"
const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh")
const BUTTON_NAME = "DSH插件回滚.cmd"

function fail(msg) { console.error("[desktop-button] ✗ " + msg); process.exit(1) }
function log(msg) { console.log("[desktop-button]", msg) }

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: isWin, timeout: opts.timeout ?? 300000, maxBuffer: 16 * 1024 * 1024 })
  return { ok: r.status === 0, status: r.status, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() }
}

function parseArgs(argv) {
  const opts = { profile: "web" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--profile") opts.profile = argv[++i]
    else if (a === "--pkg") opts.pkg = argv[++i]
    else if (a === "--home") { opts.home = argv[++i]; process.env.DSH_HOME = opts.home }
    else if (a === "--remove-button") opts.removeButton = true
    else if (a === "--desktop") opts.desktop = argv[++i]
  }
  return opts
}

function expandEnv(p) {
  return p.replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? "")
}

function desktopPath() {
  if (!isWin) {
    for (const p of [join(homedir(), "Desktop"), join(homedir(), "桌面")]) {
      if (existsSync(p)) return p
    }
    return null
  }
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders", "/v", "Desktop"], { encoding: "utf8" })
    const m = /Desktop\s+REG_SZ\s+(.+)/i.exec(out)
    if (m) {
      const p = expandEnv(m[1].trim()).trim()
      if (p && existsSync(p)) return p
    }
  } catch { /* 注册表不可用 */ }
  const fb = join(homedir(), "Desktop")
  return existsSync(fb) ? fb : null
}

function guardCliPath(profile) {
  const base = join(DSH_HOME, "profiles", profile, "node_modules")
  const direct = join(base, "dsh-plugin-guard", "scripts", "guard-cli.js")
  if (existsSync(direct)) return direct
  const pnpmDir = join(base, ".pnpm")
  if (existsSync(pnpmDir)) {
    try {
      for (const entry of readdirSync(pnpmDir)) {
        if (entry.startsWith("dsh-plugin-guard@")) {
          const p = join(pnpmDir, entry, "node_modules", "dsh-plugin-guard", "scripts", "guard-cli.js")
          if (existsSync(p)) return p
        }
      }
    } catch { /* 忽略 */ }
  }
  return null
}

function makeButton(targetDir, dshHome, cliPath, profile) {
  const nl = "\r\n"
  const body = [
    "@echo off",
    "chcp 65001 >nul",
    "echo ============================================",
    "echo   DSH 插件回滚（dsh-bie-beng · 插件别崩！！）",
    "echo   还原最近一次成功启动时的插件配置快照，并重建依赖",
    "echo   本按钮独立于 DSH 运行：DSH 崩溃时也可用",
    "echo ============================================",
    "echo.",
    "set \"DSH_HOME=" + dshHome + "\"",
    "set \"CLI=" + cliPath + "\"",
    "set \"PROFILE=" + profile + "\"",
    "if not exist \"%CLI%\" (",
    "  echo [错误] 找不到 guard CLI：%CLI%",
    "  echo 请确认 dsh-plugin-guard 已安装。",
    "  pause",
    "  exit /b 1",
    ")",
    "echo 正在回滚 profile=%PROFILE% 到最近一次好快照 ...",
    "node \"%CLI%\" rollback --good",
    "if errorlevel 1 (",
    "  echo.",
    "  echo [回滚报告了问题] 请看上方输出。",
    "  pause",
    "  exit /b 1",
    ")",
    "echo.",
    "echo 回滚完成。如果 DSH 正在运行，请重启它。",
    "pause",
  ].join(nl) + nl
  const p = join(targetDir, BUTTON_NAME)
  writeFileSync(p, body, "utf8")
  return p
}

;(async () => {
  const opts = parseArgs(process.argv.slice(2))
  log("DSH_HOME = " + DSH_HOME)
  if (opts.removeButton) {
    const dir = desktopPath()
    if (dir) {
      const p = join(dir, BUTTON_NAME)
      if (existsSync(p)) { rmSync(p); log("已删除按钮: " + p) }
      else log("按钮不存在，无需删除")
    }
    process.exit(0)
  }
  if (opts.pkg) {
    const dshBin = isWin ? "dsh.cmd" : "dsh"
    log("安装 guard: dsh plugin --profile " + opts.profile + " add " + opts.pkg)
    const r = run(dshBin, ["plugin", "--profile", opts.profile, "add", opts.pkg])
    if (!r.ok) fail("guard 安装失败: " + (r.stderr || r.stdout))
    log("✓ guard 安装成功")
  }
  const cli = guardCliPath(opts.profile)
  if (!cli) fail("找不到 guard CLI（未安装 dsh-plugin-guard 或 profile 不是 " + opts.profile + "）。先运行：dsh plugin --profile " + opts.profile + " add dsh-plugin-guard")
  log("guard CLI: " + cli)
  const desktop = opts.desktop ?? desktopPath()
  const target = desktop ?? process.cwd()
  if (!desktop) log("⚠ 未找到桌面目录，回退到当前工作目录: " + target)
  mkdirSync(target, { recursive: true })
  const btn = makeButton(target, DSH_HOME, cli, opts.profile)
  log("✓ 桌面回滚按钮已生成（覆盖式，仅一个）: " + btn)
  log("  双击即可回滚到最近一次好快照；DSH 崩溃时也可用。")
  log("  删除按钮：node scripts/install-with-desktop-button.mjs --remove-button")
  process.exit(0)
})();