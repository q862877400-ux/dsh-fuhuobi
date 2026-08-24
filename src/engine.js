// Snapshot/rollback engine. Plain synchronous Node builtins only, so it works
// identically inside the harness process (plugin tools, pre-tool guard) and
// from the standalone CLI.
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
  copyFileSync, rmSync, statSync, renameSync, lstatSync, readlinkSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync, execSync } from 'node:child_process'
import { join, dirname, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import {
  dshHome, profilesDir, profileDir, rollbacksRoot, guardDir, guardLogsDir, guardConfigPath, reviveCoinPath, reviveCoinCmdPath, SNAPSHOT_FILES,
} from './layout.js'

export const DEFAULT_KEEP_SNAPSHOTS = 10
export const MIN_KEEP_SNAPSHOTS = 2
export const MAX_KEEP_SNAPSHOTS = 100
export const DEFAULT_PORT = 3080
/** How many boot/server logs, incident reports and resolved-incident markers
 * to keep per category; the oldest are pruned on every snapshot/incident. */
export const DEFAULT_KEEP_LOGS = 30

/** Resolved DeepSeek Harness (dsh) version, recorded in every snapshot for
 * provenance. Reads the installed @deepseek-ai/dsh package next to DSH_HOME;
 * falls back to the root package.json dependency spec. Returns '' when
 * unresolvable (never throws). */
export function harnessVersion() {
  const root = dirname(dshHome())
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
    if (typeof pkg.version === 'string' && pkg.version !== '') return pkg.version
  } catch { /* fall through */ }
  try {
    const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const spec = rootPkg?.dependencies?.['@deepseek-ai/dsh']
    if (typeof spec === 'string' && spec !== '') return `spec:${spec}`
  } catch { /* unresolvable */ }
  return ''
}

/** Read the guard settings file ($DSH_HOME/guard/config.json). Never throws;
 * malformed/missing config falls back to defaults. */
export function readGuardConfig() {
  let cfg = null
  try {
    cfg = JSON.parse(readFileSync(guardConfigPath(), 'utf8'))
  } catch { /* fallthrough */ }
  const out = { keepSnapshots: DEFAULT_KEEP_SNAPSHOTS, port: DEFAULT_PORT, desktopShortcut: true }
  if (cfg && typeof cfg === 'object') {
    const n = Math.floor(Number(cfg.keepSnapshots))
    if (Number.isFinite(n) && n >= MIN_KEEP_SNAPSHOTS && n <= MAX_KEEP_SNAPSHOTS) out.keepSnapshots = n
    const p = Math.floor(Number(cfg.port))
    if (Number.isFinite(p) && p >= 1 && p <= 65535) out.port = p
    if (typeof cfg.desktopShortcut === 'boolean') out.desktopShortcut = cfg.desktopShortcut
  }
  return out
}

/** Whether the plugin may create the desktop shortcut (default true). */
export function desktopShortcutEnabled() {
  return readGuardConfig().desktopShortcut !== false
}

/** Persist the desktop-shortcut toggle. Returns the stored value. */
export function setDesktopShortcutEnabled(enabled) {
  const next = enabled === true
  writeGuardConfig({ ...readGuardConfig(), desktopShortcut: next })
  // 关闭时顺手删除桌面上已存在的快捷方式（尊重"不想桌面被动"）
  if (!next) removeReviveCoinShortcut()
  return next
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The profile's known plugin rows: patch insert rows (quarantineable via a
 * `disabled` override) plus bundle/link-dep package names (informational only).
 * Returns [{ id, name, patch }]. */
export function profilePluginRows(profile) {
  const dir = profileDir(profile)
  const rows = []
  const seen = new Set()
  const add = (id, name, patch) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    rows.push({ id, name: name || id, patch: patch === true })
  }
  try {
    const y = yaml.load(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'))
    if (Array.isArray(y)) {
      for (const e of y) {
        if (e && Array.isArray(e.insert)) {
          for (const r of e.insert) {
            if (r && typeof r.id === 'string') add(r.id, typeof r.name === 'string' ? r.name : r.id, true)
          }
        }
      }
    }
  } catch { /* unparseable patch -> no patch rows */ }
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const bundles = pkg?.dsh?.profile?.bundles
    if (Array.isArray(bundles)) for (const b of bundles) add(b, b, false)
    const deps = pkg?.dependencies ?? {}
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec === 'string' && spec.trim().toLowerCase().startsWith('link:')) add(name, name, false)
    }
  } catch { /* ignore */ }
  return rows
}

/** Extract the package names implicated by a boot failure. Handles both the
 * mount-phase abort format — `failed to <stage> loader entry <id> (<name>):`
 * (this harness's main boot-period plugin failure) — and the tree-settle
 * summary — `plugin(s) failed to load: A, B`. Each token is matched exactly
 * against the profile's patch rows later, so over-capture here is avoided by
 * taking only clean package-name tokens. */
export function extractFailedPluginNames(logText) {
  const names = []
  if (!logText) return names
  const push = (n) => { const t = String(n || '').trim(); if (t && !names.includes(t)) names.push(t) }
  // loader-entry mount failure: "failed to apply loader entry <id> (<name>): ..."
  const entryRe = /failed to \S+ loader entry \S+ \(([^)]+)\):/gi
  let m
  while ((m = entryRe.exec(logText))) push(m[1])
  // tree-settle summary: "plugin(s) failed to load: A, B"
  const settle = logText.match(/plugin\(s\) failed to load:\s*([^;\n]+)/i)
  if (settle) {
    for (const raw of settle[1].split(',')) push(raw.replace(/[()]/g, ''))
  }
  return names
}

function latestLogText(dir, re) {
  try {
    const files = readdirSync(dir).filter((f) => re.test(f)).sort()
    if (files.length === 0) return ''
    return readFileSync(join(dir, files.at(-1)), 'utf8')
  } catch { return '' }
}

/** Diagnose which plugin broke this boot: parse the latest server (err + out)
 * and boot logs for either the loader-entry mount failure or the tree-settle
 * summary, and map the first implicated name to a quarantineable patch row id
 * (matching by package name OR row id). Returns { id, name } (id null when the
 * culprit is a bundle/dep that cannot be disabled by a patch override), or
 * null when no plugin is implicated. */
export function diagnoseCulprit(profile) {
  const logs = guardLogsDir()
  const errText = latestLogText(logs, /^server-.*\.err\.log$/)
  const outText = latestLogText(logs, /^server-.*\.out\.log$/)
  const bootText = latestLogText(logs, /^boot-.*\.log$/)
  const text = `${errText}\n${outText}\n${bootText}`
  const names = extractFailedPluginNames(text)
  if (names.length === 0) return null
  const rows = profilePluginRows(profile)
  for (const name of names) {
    const row = rows.find((r) => r.patch && (r.name === name || r.id === name))
    if (row) return { id: row.id, name }
  }
  return { id: null, name: names[0] }
}

/** Disable a patch-row plugin by appending a `disabled: true` override to the
 * profile's cordis.patch.yml, and record it in guard/quarantine.json. */
export function quarantinePlugin(profile, id) {
  const dir = profileDir(profile)
  const patchPath = join(dir, 'cordis.patch.yml')
  const block = `- id: ${id}\n  disabled: true\n`
  let text = ''
  try { text = readFileSync(patchPath, 'utf8') } catch { text = '' }
  if (!new RegExp(`- id: ${escapeRegex(id)}\\s*\\n\\s*disabled:\\s*true`).test(text)) {
    const sep = text.endsWith('\n') ? '' : '\n'
    writeFileSync(patchPath, text + sep + block, 'utf8')
  }
  mkdirSync(guardDir(), { recursive: true })
  const qPath = join(guardDir(), 'quarantine.json')
  let list = []
  try { list = JSON.parse(readFileSync(qPath, 'utf8')) } catch { list = [] }
  if (!Array.isArray(list)) list = []
  list.push({ id, time: new Date().toISOString() })
  writeFileSync(qPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8')
  return { ok: true, id }
}

/** Remove the `disabled: true` override for a plugin and drop it from
 * guard/quarantine.json. */
export function unquarantinePlugin(profile, id) {
  const dir = profileDir(profile)
  const patchPath = join(dir, 'cordis.patch.yml')
  let text = ''
  try { text = readFileSync(patchPath, 'utf8') } catch { text = '' }
  const re = new RegExp(`- id: ${escapeRegex(id)}\\s*\\n\\s*disabled:\\s*true\\s*\\n?`)
  const next = text.replace(re, '')
  if (next !== text) writeFileSync(patchPath, next, 'utf8')
  const qPath = join(guardDir(), 'quarantine.json')
  try {
    const list = JSON.parse(readFileSync(qPath, 'utf8'))
    const kept = Array.isArray(list) ? list.filter((e) => e && e.id !== id) : []
    writeFileSync(qPath, `${JSON.stringify(kept, null, 2)}\n`, 'utf8')
  } catch { /* ignore */ }
  return { ok: true, id }
}

/** Every recorded quarantine [{ id, time }]. */
export function readQuarantines() {
  try {
    const list = JSON.parse(readFileSync(join(guardDir(), 'quarantine.json'), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

/** Effective per-profile snapshot retention cap. */
export function resolveKeepSnapshots() {
  return readGuardConfig().keepSnapshots
}

/** Effective web port used for health checks (config override, default 3080). */
export function resolveGuardPort() {
  return readGuardConfig().port
}

function writeGuardConfig(cfg) {
  try {
    mkdirSync(dirname(guardConfigPath()), { recursive: true })
  } catch { /* ignore */ }
  writeFileSync(guardConfigPath(), `${JSON.stringify(cfg, null, 2)}\n`, 'utf8')
}

/** Persist the retention cap (clamped to [MIN, MAX]). Returns the stored value. */
export function setKeepSnapshots(n) {
  const num = Math.max(
    MIN_KEEP_SNAPSHOTS,
    Math.min(MAX_KEEP_SNAPSHOTS, Math.floor(Number(n) || DEFAULT_KEEP_SNAPSHOTS)),
  )
  writeGuardConfig({ ...readGuardConfig(), keepSnapshots: num })
  return num
}

export function listProfiles() {
  const dir = profilesDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort()
}

function stamp() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function isWin() {
  return process.platform === 'win32'
}

/** Resolve a usable pnpm launcher. Explicit env override wins; PATH is tried
 * next; finally the harness-local .bin. Returns null when nothing exists. */
export function resolvePnpmCommand() {
  const candidates = [
    process.env.DSH_GUARD_PNPM ?? '',
    'pnpm',
    join(dirname(dshHome()), 'node_modules', '.bin', isWin() ? 'pnpm.cmd' : 'pnpm'),
    join(dshHome(), 'node_modules', '.bin', isWin() ? 'pnpm.cmd' : 'pnpm'),
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate === 'pnpm') {
      // PATH probe; on Windows go through cmd.exe to run pnpm.cmd without a shell.
      const probe = isWin()
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm --version'], { encoding: 'utf8' })
        : spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
      if (probe.status === 0) return candidate
      continue
    }
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Windows cmd token: quote only when it contains whitespace/quotes. A bare
 * token stays unquoted so cmd still resolves it via PATH (a quoted bare name
 * like "pnpm" makes cmd skip the PATH lookup). */
function cmdToken(s) {
  return /[\s"]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s)
}

/** Run pnpm. On Windows the launcher is a .cmd, so it is invoked through
 * cmd.exe explicitly (no `shell: true`, no unescaped-argument warning).
 * Tokens are quoted only when they contain whitespace/quotes: quoting a bare
 * command name breaks cmd's PATH lookup, and Node's spawnSync command-line
 * escaping additionally mangles per-arg quotes passed to cmd /c. The probe in
 * resolvePnpmCommand already uses this unquoted shape and works. */
export function runPnpm(args, cwd, pnpmCommand) {
  const command = pnpmCommand ?? resolvePnpmCommand()
  if (!command) return { ok: false, status: null, output: 'pnpm not found (PATH, DSH_GUARD_PNPM, or a local node_modules/.bin)' }
  const result = isWin()
    ? spawnSync(
        'cmd.exe',
        ['/d', '/s', '/c', [cmdToken(command), ...args.map(cmdToken)].join(' ')],
        { cwd, encoding: 'utf8', timeout: 10 * 60 * 1000 },
      )
    : spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 10 * 60 * 1000 })
  return {
    ok: result.status === 0,
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  }
}

function snapshotMatches(aDir, bDir, files) {
  for (const f of files) {
    const a = join(aDir, f)
    const b = join(bDir, f)
    if (existsSync(a) !== existsSync(b)) return false
    if (existsSync(a) && sha256File(a) !== sha256File(b)) return false
  }
  return true
}

function readManifest(dir) {
  try {
    // Strip a UTF-8 BOM: manifests written by PowerShell 5.1 carry one.
    let raw = readFileSync(join(dir, 'manifest.json'), 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeManifest(dir, profile, tag, reason, files, pnpm) {
  const m = {
    profile,
    time: new Date().toISOString(),
    tag,
    reason,
    files,
    harness: harnessVersion(),
  }
  if (pnpm) m.pnpm = pnpm
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(m, null, 2)}\n`, 'utf8')
}

/**
 * Snapshot one profile. Returns { profile, stamp } or { profile, skipped: true }.
 * The dedup check compares against the newest existing snapshot unless
 * `force` pins this state deliberately.
 */
export function snapshotProfile(profile, { tag = '', reason = '', force = false } = {}) {
  const dir = profileDir(profile)
  if (!existsSync(join(dir, 'package.json'))) {
    return { profile, error: `profile "${profile}" has no package.json` }
  }
  const newStamp = stamp()
  const snapDir = join(rollbacksRoot(profile), newStamp)
  mkdirSync(snapDir, { recursive: true })

  const saved = []
  for (const f of SNAPSHOT_FILES) {
    const src = join(dir, f)
    if (existsSync(src)) {
      copyFileSync(src, join(snapDir, f))
      saved.push(f)
    }
  }

  if (!force) {
    const root = rollbacksRoot(profile)
    const entries = existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []
    const prev = entries
      .filter((e) => e.isDirectory() && e.name !== newStamp)
      .sort((a, b) => a.name.localeCompare(b.name))
      .at(-1)
    if (prev && snapshotMatches(snapDir, join(root, prev.name), saved)) {
      rmSync(snapDir, { recursive: true, force: true })
      return { profile, skipped: true }
    }
  }

  writeManifest(snapDir, profile, tag, reason, saved, resolvePnpmCommand())
  pruneSnapshots(profile, resolveKeepSnapshots())
  pruneGuardArtifacts()
  return { profile, stamp: newStamp }
}

export function snapshotAll(tag = '', reason = '') {
  const results = []
  for (const profile of listProfiles()) {
    try {
      results.push(snapshotProfile(profile, { tag, reason }))
    } catch (error) {
      results.push({ profile, error: String(error) })
    }
  }
  return results
}

export function pruneSnapshots(profile, keep) {
  const root = rollbacksRoot(profile)
  if (!existsSync(root)) return
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name))
  for (const d of dirs.slice(keep)) rmSync(join(root, d.name), { recursive: true, force: true })
}

/** Bounded retention for the artifacts that would otherwise grow forever:
 * per-run boot/server logs, incident reports and resolved-incident markers.
 * Keeps the newest `keep` files of each category (stamp names sort
 * chronologically) and deletes the rest. `last-boot.txt` and
 * `pending-incident.json` are intentionally left untouched. Returns how many
 * files were removed. */
export function pruneGuardArtifacts(keep = DEFAULT_KEEP_LOGS) {
  const n = Math.max(1, Math.floor(Number(keep) || DEFAULT_KEEP_LOGS))
  const groups = [
    { dir: guardLogsDir(), re: /^boot-.*\.log$/ },
    { dir: guardLogsDir(), re: /^server-.*\.out\.log$/ },
    { dir: guardLogsDir(), re: /^server-.*\.err\.log$/ },
    { dir: guardLogsDir(), re: /^incident-.*\.md$/ },
    { dir: guardDir(), re: /^resolved-incident-.*\.json$/ },
  ]
  let removed = 0
  for (const { dir, re } of groups) {
    if (!existsSync(dir)) continue
    let files
    try { files = readdirSync(dir) } catch { continue }
    const matched = files.filter((f) => re.test(f)).sort()
    for (const f of matched.slice(0, Math.max(0, matched.length - n))) {
      try { rmSync(join(dir, f), { force: true }); removed++ } catch { /* best effort */ }
    }
  }
  return removed
}

export function listSnapshots(profile) {
  const root = rollbacksRoot(profile)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name))
    .map((e) => {
      const manifest = readManifest(join(root, e.name))
      return {
        stamp: e.name,
        tag: manifest?.tag ?? '',
        time: manifest?.time ?? '',
        reason: manifest?.reason ?? '',
        pnpm: manifest?.pnpm ?? '',
      }
    })
}

/**
 * Resolve one snapshot directory. `good` = newest not tagged pre-boot or
 * pre-rollback; otherwise the newest snapshot (or exact/prefixed `id`).
 */
export function resolveSnapshotDir(profile, { id = '', good = false } = {}) {
  const root = rollbacksRoot(profile)
  if (!existsSync(root)) return null
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name))
  if (dirs.length === 0) return null
  if (id) {
    const hit = dirs.find((e) => e.name === id || e.name.startsWith(id))
    return hit ? join(root, hit.name) : null
  }
  if (good) {
    for (const e of dirs) {
      const manifest = readManifest(join(root, e.name))
      const tag = manifest?.tag ?? ''
      if (tag !== 'pre-boot' && tag !== 'pre-rollback') return join(root, e.name)
    }
  }
  return join(root, dirs[0].name)
}

/**
 * Restore one snapshot for one profile. Always snapshots the current state
 * first (tag pre-rollback), so every rollback is itself reversible.
 */
export function restoreSnapshot(profile, snapshotDir, { skipInstall = false } = {}) {
  snapshotProfile(profile, { tag: 'pre-rollback', reason: `rollback to ${snapshotDir}` })
  const dir = profileDir(profile)
  for (const f of SNAPSHOT_FILES) {
    const src = join(snapshotDir, f)
    const dst = join(dir, f)
    if (existsSync(src)) copyFileSync(src, dst)
    else if (existsSync(dst)) rmSync(dst, { force: true })
  }
  let pnpm = null
  if (!skipInstall) {
    const manifest = readManifest(snapshotDir)
    const command = manifest?.pnpm && existsSync(manifest.pnpm) ? manifest.pnpm : null
    pnpm = runPnpm(['install', '--frozen-lockfile'], dir, command)
  }
  // pnpm install --frozen-lockfile / pnpm prune both report "Already up to
  // date" and never remove a stale link: bundle entry whose target lives
  // outside node_modules, so clean those symlinks directly.
  const removedLinks = cleanupStaleBundleLinks(profile)
  return { restored: SNAPSHOT_FILES, pnpm, removedLinks }
}

/** Names that must keep a node_modules link for this profile: every `link:`
 * dependency in package.json (bundle plugins are installed this way) plus the
 * dsh.profile.bundles list (harmless extra safety). */
function validLinkNames(pkg) {
  const names = new Set()
  const deps = pkg?.dependencies ?? {}
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec === 'string' && spec.trim().toLowerCase().startsWith('link:')) names.add(name)
  }
  const bundles = pkg?.dsh?.profile?.bundles
  if (Array.isArray(bundles)) for (const b of bundles) names.add(b)
  return names
}

/**
 * Remove orphaned bundle-plugin symlinks left in node_modules after a rollback
 * (or any bundle-stack change). Scans node_modules for symlinks/junctions whose
 * resolved target is OUTSIDE node_modules (bundle `link:` deps point at the
 * plugins dir) and whose name is no longer a `link:` dependency / bundle in the
 * restored package.json, and deletes exactly those links — never their targets
 * and never normal pnpm deps (which link inside node_modules/.pnpm). Returns
 * the removed names.
 */
export function cleanupStaleBundleLinks(profile) {
  const dir = profileDir(profile)
  const nm = join(dir, 'node_modules')
  if (!existsSync(nm)) return []
  let pkg = null
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch { /* broken package.json -> no valid set -> treat stale links as stale */ }
  const valid = validLinkNames(pkg)
  const removed = []
  const scan = (base, prefix) => {
    let entries = []
    try { entries = readdirSync(base, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(base, e.name)
      let st
      try { st = lstatSync(p) } catch { continue }
      // real directory that is a scoped namespace -> descend into it
      if (st.isDirectory() && !st.isSymbolicLink() && e.name.startsWith('@')) {
        scan(p, e.name)
        continue
      }
      if (!st.isSymbolicLink()) continue
      let target = ''
      try { target = readlinkSync(p) } catch { continue }
      const abs = resolve(dirname(p), target)
      // normal pnpm deps link inside node_modules (.pnpm/...) -> keep
      if (abs === nm || abs.startsWith(nm + sep)) continue
      const name = prefix ? `${prefix}/${e.name}` : e.name
      if (valid.has(name)) continue
      try { rmSync(p, { recursive: true, force: true }); removed.push(name) } catch { /* best effort */ }
    }
  }
  scan(nm, '')
  return removed
}

// ── 复活币引擎 ─────────────────────────────────────────────
//
// 三级旋转规则（每个 profile 独立）：
//   1. 新快照 → 当前复活币（current）
//   2. 旧 current → 前次备份（previous）
//   3. 旧 previous → 删除
// 永不超出 2 份复活币专用快照。

/**
 * 读取复活币状态文件。返回 { current: string|null, previous: string|null }。
 * 文件不存在或异常时返回 null 值。
 */
export function readReviveCoin() {
  try {
    const raw = JSON.parse(readFileSync(reviveCoinPath(), 'utf8'))
    return {
      current: typeof raw.current === 'string' && raw.current !== '' ? raw.current : null,
      previous: typeof raw.previous === 'string' && raw.previous !== '' ? raw.previous : null,
    }
  } catch {
    return { current: null, previous: null }
  }
}

/**
 * 标记一枚新的复活币（三级旋转）：
 * 1. 对指定 profile 做一次快照（tag=revive-coin）
 * 2. 旧 current → previous，旧 previous → 删除
 * 3. 新快照的 stamp 作为 current
 * 4. 写入 revive-coin.json
 * 5. 在 $DSH_HOME 下创建/更新 DSH复活币X1.cmd
 * 6. 尝试在桌面创建快捷方式
 */
export function markReviveCoin(profile) {
  // 1. 创建新快照
  const snap = snapshotProfile(profile, { tag: 'revive-coin', reason: '复活币：成功启动自动存币', force: true })
  if (snap.error) return { ok: false, error: snap.error }
  const newStamp = snap.stamp

  // 2. 三级旋转
  const prev = readReviveCoin()
  const oldPrevious = typeof prev.previous === 'string' ? prev.previous : null

  // 如果有旧的 previous，删掉它对应的快照目录
  if (oldPrevious) {
    const oldDir = join(rollbacksRoot(profile), oldPrevious)
    try { rmSync(oldDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }

  const coin = { current: newStamp, previous: prev.current }
  mkdirSync(guardDir(), { recursive: true })
  writeFileSync(reviveCoinPath(), `${JSON.stringify(coin, null, 2)}\n`, 'utf8')

  // 3. 创建 DSH复活币X1.cmd
  writeReviveCoinCmd(profile)

  // 4. 尝试创建桌面快捷方式（尊重用户开关；未开启时静默跳过）
  if (desktopShortcutEnabled()) {
    try {
      createReviveCoinShortcut()
    } catch { /* 无桌面权限时静默跳过 */ }
  }

  return { ok: true, stamp: newStamp, previous: coin.previous }
}

/**
 * 写入 $DSH_HOME/DSH复活币X1.cmd — 双击即可回滚到当前复活币快照。
 */
export function writeReviveCoinCmd(profile) {
  const cmdPath = reviveCoinCmdPath()
  const isWin = process.platform === 'win32'
  const nodeCmd = isWin ? 'node.exe' : 'node'
  const cliPath = join(guardDir(), '..', 'profiles', profile, 'node_modules', 'dsh-fuhuobi', 'scripts', 'guard-cli.js')

  // Fallback: 尝试从 harness 根找
  const fallbackCli = join(dirname(dshHome()), 'node_modules', 'dsh-fuhuobi', 'scripts', 'guard-cli.js')

  const content = [
    '@echo off',
    'chcp 65001 >nul',
    'echo.',
    'echo ==============================================',
    'echo        DSH 复活币 X1',
    'echo  双击此文件可恢复 DSH 至上次成功启动状态',
    'echo ==============================================',
    'echo.',
    '',
    'rem 1) DSH_HOME 环境变量（由启动器设置）',
    'set "CLI_PATH=%DSH_HOME%\\profiles\\web\\node_modules\\dsh-fuhuobi\\scripts\\guard-cli.js"',
    'if not exist "%CLI_PATH%" set "CLI_PATH="',
    '',
    'rem 2) 从本文件位置推导：本文件在 $DSH_HOME\\ 下',
    'if not defined CLI_PATH (',
    '  if exist "%~dp0profiles\\web\\node_modules\\dsh-fuhuobi\\scripts\\guard-cli.js" set "CLI_PATH=%~dp0profiles\\web\\node_modules\\dsh-fuhuobi\\scripts\\guard-cli.js"',
    ')',
    '',
    'rem 3) 兜底：上一级目录的 node_modules（harness 根）',
    'if not defined CLI_PATH (',
    '  if exist "%~dp0..\\node_modules\\dsh-fuhuobi\\scripts\\guard-cli.js" set "CLI_PATH=%~dp0..\\node_modules\\dsh-fuhuobi\\scripts\\guard-cli.js"',
    ')',
    '',
    'if defined CLI_PATH (',
    '  node "%CLI_PATH%" revive-coin --use',
    '  echo.',
    '  echo [DSH 复活币] 按任意键关闭本窗口。',
    '  pause >nul',
    ') else (',
    '  echo [DSH 复活币] 找不到 guard-cli.js，请确认 dsh-fuhuobi 已安装。',
    '  pause',
    '  exit /b 1',
    ')',
    'exit /b 0',
  ].join('\r\n')

  mkdirSync(dirname(cmdPath), { recursive: true })
  writeFileSync(cmdPath, content, 'utf8')
}

/**
 * 在桌面创建 DSH复活币X1.lnk 快捷方式（Windows 专用）。
 * 使用 PowerShell 的 COM 接口创建 .lnk。
 */
export function createReviveCoinShortcut() {
  if (process.platform !== 'win32') return
  const cmdPath = reviveCoinCmdPath()
  // 保险：只有 cmd 确实存在时才创建快捷方式，避免把目标指向不存在的路径
  // （例如冒烟测试用临时 DSH_HOME 时，cmd 会在临时目录，不该污染真实桌面）。
  if (!existsSync(cmdPath)) return
  const desktop = join(homedir(), 'Desktop')
  const lnkPath = join(desktop, 'DSH复活币X1.lnk')

  // 图标：优先用插件自带的黄色像素风硬币（随包分发），找不到则回退到
  // $DSH_HOME/fuhuobi-icon/coin.ico，仍未找到就输出空（系统默认图标）。
  const iconPath = resolveReviveCoinIconPath()

  const psScript = [
    `$ws = New-Object -ComObject WScript.Shell`,
    `$sc = $ws.CreateShortcut('${lnkPath.replace(/'/g, "''")}')`,
    `$sc.TargetPath = '${cmdPath.replace(/'/g, "''")}'`,
    `$sc.Description = '双击使用复活币恢复 DSH 至上次成功启动状态'`,
  ]
  if (iconPath) {
    psScript.push(`$sc.IconLocation = '${iconPath.replace(/'/g, "''")}'`)
  }
  psScript.push(`$sc.Save()`)

  const result = spawnSync(
    process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell',
    ['-NoProfile', '-NonInteractive', '-Command', psScript.join('; ')],
    { encoding: 'utf8', timeout: 10000 },
  )
  // 忽略错误（无桌面权限等）
}

/**
 * 定位复活币快捷方式图标：
 * 1. 自定义图标 $DSH_HOME/guard/custom-coin.ico（用户上传，若有）
 * 2. 插件安装目录 assets/coin.ico（随 npm 包分发）
 * 3. $DSH_HOME/fuhuobi-icon/coin.ico（本地兜底）
 * 均不存在则返回 null（系统默认图标）。
 */
export function resolveReviveCoinIconPath() {
  // 1. 用户自定义图标优先
  const customIcon = join(guardDir(), 'custom-coin.ico')
  if (existsSync(customIcon)) return customIcon
  // 2. 插件自带默认（随包分发）
  try {
    const selfDir = dirname(fileURLToPath(import.meta.url))
    const pkgIcon = join(selfDir, '..', 'assets', 'coin.ico')
    if (existsSync(pkgIcon)) return pkgIcon
  } catch { /* import.meta.url 不可用 */ }
  // 3. 本地兜底
  const homeIcon = join(dshHome(), 'fuhuobi-icon', 'coin.ico')
  if (existsSync(homeIcon)) return homeIcon
  return null
}

/**
 * 保存用户自定义快捷方式图标。接收上传的图片 buffer（PNG/JPG/ICO），
 * 转成 256 或原尺寸 ICO 存到 $DSH_HOME/guard/custom-coin.ico。
 * 返回保存后的 .ico 路径；失败返回 null。
 */
/** 是否有可用的 Python + PIL（用于 PNG/JPG → ICO 转换）。 */
export function hasPythonPil() {
  try {
    const r = spawnSync('python', ['-c', 'import PIL'], { encoding: 'utf8', timeout: 5000 })
    return r.status === 0
  } catch { return false }
}

/**
 * 保存用户自定义快捷方式图标。
 * - 若上传的是 .ico 截断/已含 ICO 头 → 直接保存。
 * - 若是 PNG/JPG 且机器有 Python+PIL → 用 PIL 转成多尺寸 ICO。
 * - 无 Python 时原样保存（可能读不了，前端会提示只能传 .ico）。
 * 返回保存后的路径；失败返回 null。
 */
export function saveCustomCoinIcon(buffer) {
  try {
    if (!buffer || buffer.length === 0) return null
    mkdirSync(guardDir(), { recursive: true })
    const outPath = join(guardDir(), 'custom-coin.ico')
    const buf = Buffer.from(buffer)

    // 判断是否已是 ICO（以 00 00 01 00 开头）或用户签名
    const isIco = buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00

    if (!isIco && hasPythonPil()) {
      // 用 Python PIL 转成多尺寸 ICO。传入临时文件，转换后读回。
      const tmpIn = join(guardDir(), 'custom-coin-input')
      const tmpOut = join(guardDir(), 'custom-coin.ico')
      writeFileSync(tmpIn, buf)
      const script = [
        `from PIL import Image`,
        `import sys`,
        `img = Image.open(r'${tmpIn.replace(/\\/g, '\\\\')}').convert('RGBA')`,
        `img.save(r'${tmpOut.replace(/\\/g, '\\\\')}', format='ICO', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])`,
      ].join('\n')
      const r = spawnSync('python', ['-c', script], { encoding: 'utf8', timeout: 10000 })
      try { rmSync(tmpIn, { force: true }) } catch { /* best effort */ }
      if (r.status === 0 && existsSync(tmpOut)) return tmpOut
      // 转换失败：回退原样保存（若用户传的其实是 .ico 内容）
    }

    // 无 Python 或非图片：原样保存（前端已限制 .ico 时走这里）
    writeFileSync(outPath, buf)
    return outPath
  } catch { return null }
}

/** 是否有用户自定义图标存在。 */
export function hasCustomCoinIcon() {
  return existsSync(join(guardDir(), 'custom-coin.ico'))
}

/** 删除用户自定义图标（回到默认）。 */
export function clearCustomCoinIcon() {
  try { rmSync(join(guardDir(), 'custom-coin.ico'), { force: true }) } catch { /* best effort */ }
}

/**
 * 删除桌面 DSH复活币X1.lnk 快捷方式（Windows 专用，用户关闭开关时调用）。
 */
export function removeReviveCoinShortcut() {
  if (process.platform !== 'win32') return
  const desktop = join(homedir(), 'Desktop')
  const lnkPath = join(desktop, 'DSH复活币X1.lnk')
  try { rmSync(lnkPath, { force: true }) } catch { /* best effort */ }
}

/**
 * 解析当前复活币对应的快照目录。无复活币时返回 null。
 */
export function resolveReviveCoinSnapshot(profile) {
  const coin = readReviveCoin()
  if (!coin.current) return null
  return resolveSnapshotDir(profile, { id: coin.current })
}

export { stamp, sha256File }
