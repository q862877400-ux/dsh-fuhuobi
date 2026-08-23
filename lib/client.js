// dsh-fuhuobi — 设置 > 复活币口袋 client 半。
// 数据通过 fetch 调 host 的 /fuhuobi/api/* HTTP 路由：
//   state        列出各 profile 的快照 + 当前保留数量
//   snapshot     手动存档（可选指定 profile）
//   rollback     加载（还原）指定快照
//   keep         设置每个 profile 最多保留的快照数量（最少 2）
//   revive-coin  查看 / 手动存复活币
// 渲染模式与 dsh-skill-center 一致：__ModuleLoader__ + React.createElement。

window.__ModuleLoader__.load({
  id: 'dsh-fuhuobi',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const CSS = `
.gdb-wrap{display:flex;flex-direction:column;gap:14px;min-height:420px}
.gdb-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gdb-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.gdb-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gdb-hint.gdb-err{color:var(--dsw-alias-state-error-primary)}
.gdb-btn{font-family:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 12px;cursor:pointer}
.gdb-btn:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.gdb-btn[disabled]{opacity:.5;cursor:not-allowed}
.gdb-btn.gdb-primary{background:var(--dsw-alias-state-business-primary);color:#fff;border:none}
.gdb-btn.gdb-danger{color:var(--dsw-alias-state-error-primary)}
.gdb-input{font-family:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;box-sizing:border-box;width:72px}
.gdb-select{font-family:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;box-sizing:border-box}
.gdb-profiles{display:flex;flex-direction:column;gap:12px}
.gdb-prof{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px}
.gdb-prof-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.gdb-prof-name{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}
.gdb-prof-desc{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gdb-prof-count{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.gdb-list{display:flex;flex-direction:column;gap:4px}
.gdb-snap{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;border:1px solid transparent}
.gdb-snap:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.gdb-stamp{font-family:ui-monospace,Consolas,'Courier New',monospace;font-size:11px;color:var(--dsw-alias-label-primary);min-width:150px}
.gdb-tag{font-size:10px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);border-radius:6px;padding:2px 6px;white-space:nowrap}
.gdb-time{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.gdb-reason{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gdb-load{font-family:inherit;font-size:11px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;cursor:pointer;white-space:nowrap}
.gdb-load:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.gdb-load.gdb-confirm{color:#fff;background:var(--dsw-alias-state-error-primary);border-color:transparent}
.gdb-load[disabled]{opacity:.5;cursor:not-allowed}
.gdb-status{font-size:12px;color:var(--dsw-alias-label-tertiary);min-height:16px}
.gdb-status.gdb-err{color:var(--dsw-alias-state-error-primary)}
.gdb-status.gdb-ok{color:var(--dsw-alias-state-success-primary)}
.gdb-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:10px;text-align:center}
.gdb-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.gdb-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.gdb-card-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.gdb-card-head{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.gdb-card-title{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4;flex:1}
.gdb-card-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.gdb-card-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.gdb-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.gdb-field-head{align-items:center;gap:8px;display:flex}
.gdb-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.gdb-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.gdb-input-invalid{border-color:var(--dsw-alias-state-error-primary)}
.gdb-invalid{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:1.5}
.gdb-card-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.gdb-card-footer .gdb-hint{flex:1}
`

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-fuhuobi'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    async function api(method, args) {
      const base = '/fuhuobi/api/' + method
      if (method === 'snapshot' || method === 'rollback' || method === 'keep' || method === 'desktop-shortcut') {
        const r = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args || {}),
        })
        return r.json()
      }
      const q = new URLSearchParams()
      if (args) for (const k in args) { const v = args[k]; if (v !== undefined && v !== null && v !== '') q.set(k, String(v)) }
      const r = await fetch(base + (q.toString() ? '?' + q.toString() : ''))
      return r.json()
    }

    const fmtTime = (iso) => {
      if (!iso) return ''
      const d = new Date(iso)
      return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
    }

    const TAG_LABEL = { 'pre-boot': '启动前', 'pre-rollback': '回退前', 'auto-before-install': '安装前', manual: '手动', 'known-good': '良好基线' }
    // 环境 = 一套独立的运行配置（D 上的安装清单）。web 是网页版主环境，headless 是无界面模式。
    const ENV_DESC = { web: '网页版主环境（你现在用的界面）', headless: '无界面模式（命令行/后台启动）' }

    function BackupsSection() {
      const [phase, setPhase] = React.useState('loading')
      const [profiles, setProfiles] = React.useState([])
      const [keep, setKeep] = React.useState(10)
      const [keepInput, setKeepInput] = React.useState('10')
      const [selProfile, setSelProfile] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [confirm, setConfirm] = React.useState(null) // { profile, stamp }
      const [status, setStatus] = React.useState({ text: '', kind: '' })
      const [desktopShortcut, setDesktopShortcut] = React.useState(true)

      const refresh = async () => {
        try {
          const r = await api('state')
          if (r && r.ok) { setProfiles(r.profiles || []); setKeep(r.keepSnapshots); setKeepInput(String(r.keepSnapshots)); setDesktopShortcut(r.desktopShortcut !== false) }
          else setStatus({ text: (r && r.error) || '加载失败', kind: 'err' })
        } catch (e) { setStatus({ text: String((e && e.message) || e), kind: 'err' }) }
        setPhase('ready')
      }
      React.useEffect(() => { refresh() }, [])

      const doToggleDesktopShortcut = async (next) => {
        setBusy(true); setStatus({ text: '', kind: '' })
        try {
          const r = await api('desktop-shortcut', { enabled: next })
          if (r && r.ok) {
            setDesktopShortcut(r.desktopShortcut !== false)
            setStatus({ text: r.desktopShortcut ? '已开启：每次存复活币时自动在桌面创建 DSH复活币X1 快捷方式' : '已关闭：不再在桌面创建快捷方式（DSH 根目录的 DSH复活币X1.cmd 仍会生成）', kind: 'ok' })
          } else setStatus({ text: (r && r.error) || '保存失败', kind: 'err' })
        } catch (e) { setStatus({ text: String((e && e.message) || e), kind: 'err' }) }
        setBusy(false)
      }

      const doSnapshot = async () => {
        setBusy(true); setStatus({ text: '', kind: '' })
        try {
          const r = await api('snapshot', selProfile ? { profile: selProfile } : {})
          if (r && r.ok) {
            const made = (r.results || []).filter((x) => x.stamp)
            const skipped = (r.results || []).filter((x) => x.skipped)
            setStatus({ text: made.length ? `已存档 ${made.map((x) => `${x.profile}:${x.stamp}`).join('，')}` : '状态无变化（与最近备份相同，已跳过）', kind: 'ok' })
            await refresh()
          } else setStatus({ text: (r && r.error) || '存档失败', kind: 'err' })
        } catch (e) { setStatus({ text: String((e && e.message) || e), kind: 'err' }) }
        setBusy(false)
      }

      const doRollback = async (profile, stamp) => {
        setBusy(true); setStatus({ text: '', kind: '' }); setConfirm(null)
        try {
          const r = await api('rollback', { profile, stamp })
          if (r && r.ok) {
            const note = r.warning ? `已还原 ${r.stamp}；${r.warning}` : `已加载备份 ${r.stamp}`
            setStatus({ text: note + (r.note ? ` ${r.note}` : ''), kind: r.warning ? 'err' : 'ok' })
            await refresh()
          } else setStatus({ text: (r && r.error) || '加载失败', kind: 'err' })
        } catch (e) { setStatus({ text: String((e && e.message) || e), kind: 'err' }) }
        setBusy(false)
      }

      const doSaveKeep = async () => {
        const n = Math.floor(Number(keepInput))
        if (!Number.isFinite(n) || n < 2) { setStatus({ text: '保留数量至少为 2', kind: 'err' }); return }
        setBusy(true); setStatus({ text: '', kind: '' })
        try {
          const r = await api('keep', { keep: n })
          if (r && r.ok) { setKeep(r.keepSnapshots); setKeepInput(String(r.keepSnapshots)); setStatus({ text: `已保存：每个环境最多保留 ${r.keepSnapshots} 份快照`, kind: 'ok' }) }
          else setStatus({ text: (r && r.error) || '保存失败', kind: 'err' })
        } catch (e) { setStatus({ text: String((e && e.message) || e), kind: 'err' }) }
        setBusy(false)
      }

      const profileOptions = ['', ...profiles.map((p) => p.name)]

      const profilePanels = profiles.length === 0
        ? React.createElement('div', { className: 'gdb-empty' }, phase === 'loading' ? '加载中…' : '暂无快照。点「＋ 手动存档」创建第一份备份。')
        : React.createElement(React.Fragment, null,
            profiles.map((p) => React.createElement('div', { key: p.name, className: 'gdb-prof' },
              React.createElement('div', { className: 'gdb-prof-head' },
                React.createElement('h4', { className: 'gdb-prof-name' }, `环境 ${p.name}`),
                React.createElement('span', { className: 'gdb-prof-desc' }, ENV_DESC[p.name] || '独立配置环境'),
                React.createElement('span', { className: 'gdb-prof-count' }, `${p.snapshots.length} 份`),
              ),
              p.snapshots.length === 0
                ? React.createElement('div', { className: 'gdb-empty' }, '暂无快照')
                : React.createElement('div', { className: 'gdb-list' },
                    p.snapshots.map((s) => {
                      const isConfirm = confirm && confirm.profile === p.name && confirm.stamp === s.stamp
                      return React.createElement('div', { key: s.stamp, className: 'gdb-snap' },
                        React.createElement('span', { className: 'gdb-stamp' }, s.stamp),
                        React.createElement('span', { className: 'gdb-tag' }, TAG_LABEL[s.tag] || s.tag || '—'),
                        React.createElement('span', { className: 'gdb-time' }, fmtTime(s.time)),
                        React.createElement('span', { className: 'gdb-reason', title: s.reason }, s.reason || ''),
                        React.createElement('button', {
                          className: 'gdb-load' + (isConfirm ? ' gdb-confirm' : ''),
                          disabled: busy,
                          onClick: () => isConfirm ? doRollback(p.name, s.stamp) : setConfirm({ profile: p.name, stamp: s.stamp }),
                        }, isConfirm ? '确认使用此复活币？' : '用此复活币复活'),
                      )
                    }),
                  ),
            )))

      return React.createElement('div', { className: 'gdb-wrap' },
        React.createElement('div', { className: 'gdb-toolbar' },
          React.createElement('h3', { className: 'gdb-title' }, '复活币口袋'),
          React.createElement('span', { className: 'gdb-hint' }, '每个环境最多保留'),
          React.createElement('input', {
            className: 'gdb-input', type: 'number', min: 2, value: keepInput,
            onChange: (e) => setKeepInput(e.target.value),
          }),
          React.createElement('span', { className: 'gdb-hint' }, '份（最少 2）'),
          React.createElement('button', { className: 'gdb-btn', disabled: busy || String(keepInput) === String(keep), onClick: doSaveKeep }, '保存'),
          React.createElement('div', { style: { flex: 1 } }),
          React.createElement('select', { className: 'gdb-select', value: selProfile, onChange: (e) => setSelProfile(e.target.value) },
            React.createElement('option', { value: '' }, '全部环境'),
            profiles.map((p) => React.createElement('option', { key: p.name, value: p.name }, p.name)),
          ),
          React.createElement('button', { className: 'gdb-btn gdb-primary', disabled: busy, onClick: doSnapshot }, busy ? '处理中…' : '＋ 手动存币'),
          // 桌面快捷方式开关：尊重不想桌面被动的用户（关闭后不再创建 .lnk）
          React.createElement('label', { className: 'gdb-hint', style: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } },
            React.createElement('input', {
              type: 'checkbox',
              checked: desktopShortcut,
              disabled: busy,
              onChange: (e) => doToggleDesktopShortcut(e.target.checked),
              style: { cursor: 'pointer' },
            }),
            '桌面快捷方式',
          ),
        ),
        React.createElement('div', { className: 'gdb-hint' }, '说明：「环境」指一套独立的运行配置——web 是网页版主环境（你现在用的界面），headless 是无界面模式（命令行/后台启动）。「用此复活币复活」会还原该环境的 4 个配置文件并重跑 pnpm install --frozen-lockfile；使用前会自动存一份「回退前」快照（可逆），完成后请重启应用使更改生效。'),
        React.createElement('div', { className: 'gdb-profiles' }, profilePanels),
        React.createElement('div', { className: 'gdb-status' + (status.kind ? ' gdb-' + status.kind : ''), style: { minHeight: '16px' } }, status.text || ''),
      )
    }

    // ── 设置 > 插件 > 插件配置 card（rc.7 插件自有设置表面）──
    // Binds the `guard` settings namespace (registered by the host half) and
    // edits the keepSnapshots field with the settingsScope's revision fencing.
    // Mirrors the dsh-vision-router plugin card pattern.
    function GuardCard(props) {
      const scope = props.scope
      const subscribe = React.useMemo(() => scope.subscribe.bind(scope), [scope])
      const getSnapshot = React.useMemo(() => scope.getSnapshot.bind(scope), [scope])
      const [drafts, setDrafts] = React.useState({})
      const [saving, setSaving] = React.useState(false)
      const [failed, setFailed] = React.useState(false)
      const [open, setOpen] = React.useState(false)
      let snapshot = null
      try {
        snapshot = React.useSyncExternalStore(subscribe, getSnapshot)
      } catch { snapshot = null }
      if (!snapshot || snapshot.status !== 'ready') return null // namespace unavailable: render nothing
      const writable = snapshot.writable
      const current = snapshot.value && Number.isFinite(snapshot.value.keepSnapshots) ? snapshot.value.keepSnapshots : 10
      const currentDs = snapshot.value && typeof snapshot.value.desktopShortcut === 'boolean' ? snapshot.value.desktopShortcut : true
      const draft = 'keepSnapshots' in drafts ? drafts.keepSnapshots : String(current)
      const dirty = Object.keys(drafts).length > 0
      const n = Number(draft)
      const invalid = !Number.isFinite(n) || n < 2 || n > 100
      const blocked = !dirty || invalid || saving || !writable

      const save = async () => {
        if (blocked) return
        setSaving(true); setFailed(false)
        const ok = await scope.set('keepSnapshots', Math.floor(n)).then(() => true, () => false)
        if (ok) setDrafts({})
        setSaving(false)
        setFailed(!ok)
      }

      const toggleDs = async () => {
        setSaving(true); setFailed(false)
        const ok = await scope.set('desktopShortcut', !currentDs).then(() => true, () => false)
        setSaving(false)
        setFailed(!ok)
      }

      const h = React.createElement
      return h('li', { className: 'gdb-card' + (open ? ' gdb-card-open' : '') },
        h('button', {
          type: 'button', className: 'gdb-card-head', 'aria-expanded': open,
          onClick: () => setOpen(!open),
        },
          h('span', { className: 'gdb-card-title' }, '复活币口袋（dsh-fuhuobi）'),
          h('span', { className: 'gdb-card-desc' }, dirty ? '（有未保存的修改）' : '复活币：启动成功自动存币，双击即可复活'),
        ),
        open
          ? h('div', { className: 'gdb-card-body' },
              h('div', { className: 'gdb-field' },
                h('div', { className: 'gdb-field-head' },
                  h('span', { className: 'gdb-label' }, '每个环境保留的快照数量（最少 2）'),
                  h('span', { className: 'gdb-badge' }, writable ? '可编辑' : '只读'),
                ),
                h('input', {
                  className: 'gdb-input' + (invalid ? ' gdb-input-invalid' : ''), type: 'number', min: 2,
                  value: draft, disabled: !writable,
                  onChange: (e) => { setFailed(false); setDrafts({ keepSnapshots: e.target.value }) },
                }),
                invalid ? h('p', { className: 'gdb-invalid' }, '保留数量必须在 2–100 之间') : null,
                failed ? h('p', { className: 'gdb-invalid' }, '保存失败：宿主拒绝了本次写入，请重试。') : null,
              ),
              h('div', { className: 'gdb-field' },
                h('div', { className: 'gdb-field-head' },
                  h('span', { className: 'gdb-label' }, '桌面创建 DSH复活币X1 快捷方式'),
                  h('span', { className: 'gdb-badge' }, writable ? '可编辑' : '只读'),
                ),
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' } },
                  h('input', { type: 'checkbox', checked: currentDs, disabled: !writable || saving, onChange: toggleDs, style: { cursor: 'pointer' } }),
                  currentDs ? '开启（每次存复活币时在桌面创建快捷方式）' : '关闭（不动桌面，仅 DSH 根目录保留 DSH复活币X1.cmd）',
                ),
                failed ? h('p', { className: 'gdb-invalid' }, '保存失败：宿主拒绝了本次写入，请重试。') : null,
              ),
              h('div', { className: 'gdb-card-footer' },
                h('button', { type: 'button', className: 'gdb-btn', disabled: !dirty || saving, onClick: () => { setFailed(false); setDrafts({}) } }, '放弃修改'),
                h('button', { type: 'button', className: 'gdb-btn gdb-primary', disabled: blocked, onClick: save }, saving ? '保存中…' : '保存'),
              ),
              h('p', { className: 'gdb-hint' }, '完整管理（查看复活币 / 一键复活 / 手动存币 / 桌面快捷方式开关）在 设置 → 复活币口袋 页面。'),
            )
          : null,
      )
    }

    // ── 启动心跳（黑屏检测）──
    // Renders nothing; on mount it proves the render tree actually mounted and
    // tells the host, which the boot-guard waits for after HTTP is up. If the
    // root entry crashes (rc.7 黑屏), the crash overlay (below) takes over.
    function BootHeartbeat() {
      React.useEffect(() => {
        try { fetch('/fuhuobi/api/booted', { method: 'POST' }).catch(() => {}) } catch { /* best effort */ }
      }, [])
      return null
    }

    // ── 黑屏崩溃覆盖层 ──
    // 根组件渲染崩溃时，立即渲染一个全屏覆盖层：魂系复活界面 + 右上角 ✕
    // 关闭按钮。点击「使用复活币」POST /fuhuobi/api/rollback?good=true 回滚，
    // 成功后刷新页面。✕ 只关闭覆盖层（不恢复崩溃的根组件），方便用户查看
    // 控制台/原页面报错信息，或改用桌面 DSH复活币X1.cmd。
    function CrashOverlay({ message }) {
      const [closing, setClosing] = React.useState(false)
      const [working, setWorking] = React.useState(false)
      const [done, setDone] = React.useState(false)
      const [err, setErr] = React.useState('')

      const doRevive = async () => {
        setWorking(true); setErr('')
        try {
          const r = await fetch('/fuhuobi/api/rollback?good=true', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: '', stamp: '' }),
          })
          const data = await r.json()
          if (data && data.ok) {
            setDone(true)
            setTimeout(() => { window.location.reload() }, 1500)
          } else {
            setErr((data && data.error) || '复活失败，请改用桌面 DSH复活币X1.cmd')
            setWorking(false)
          }
        } catch (e) {
          setErr('复活请求失败，请改用桌面 DSH复活币X1.cmd')
          setWorking(false)
        }
      }

      const h = React.createElement
      const closeBtn = h('button', {
        onClick: () => setClosing(true),
        style: {
          position: 'absolute', top: '18px', right: '24px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: '33px', color: 'rgba(255,255,255,.85)', lineHeight: '1',
          padding: '9px', zIndex: 2,
        },
        'aria-label': '关闭',
        title: '关闭（可改用桌面 DSH复活币X1.cmd 恢复）',
      }, '✕')

      if (closing) return null
      return h('div', {
        style: {
          position: 'fixed', inset: '0', zIndex: 999999,
          background: 'rgba(8,6,12,.96)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'ui-monospace, Consolas, "Courier New", monospace',
        },
      },
        closeBtn,
        h('div', { style: { maxWidth: '840px', padding: '48px', textAlign: 'center', color: '#e8e2d8' } },
          h('div', { style: { fontSize: '108px', fontWeight: 'bold', letterSpacing: '18px', color: '#c1121f', marginBottom: '18px', textShadow: '0 0 45px rgba(193,18,31,.6), 0 0 12px rgba(193,18,31,.8)' } }, 'DIE'),
          h('div', { style: { fontSize: '25.5px', lineHeight: '1.8', marginBottom: '42px', color: '#d8cfc2' } },
            'DSH 因插件崩溃而倒下。', h('br'),
            '别怕，复活币还在。', h('br'),
            h('span', { style: { color: '#8a8078', fontSize: '19.5px' } }, '（回滚到上一次成功启动的状态）')),
          h('button', {
            disabled: working || done,
            onClick: doRevive,
            style: {
              fontSize: '25.5px', padding: '21px 66px', cursor: working ? 'wait' : 'pointer',
              background: 'linear-gradient(180deg,#6b4a2f,#4a3220)',
              border: '1px solid #8a6a45', borderRadius: '12px', color: '#ffe9c9',
              letterSpacing: '4.5px', fontFamily: 'inherit',
            },
          }, done ? '已恢复，即将刷新…' : working ? '复活中…' : '🔥 使用复活币'),
          err ? h('div', { style: { marginTop: '24px', color: '#c96b5b', fontSize: '19.5px' } }, err) : null,
          h('div', { style: { marginTop: '42px', fontSize: '18px', color: '#6f665c', lineHeight: '1.7' } },
            '若网页也打不开，请到 DSH 根目录或桌面双击', h('br'),
            '「DSH复活币X1」手动恢复。'),
        ),
      )
    }

    function apply(ctx) {
      // Every contribution below is defensive: if a DSH build changes an API we
      // use, the guard degrades gracefully instead of throwing during the
      // client boot and black-screening the whole web app.
      const slots = ctx.slots

      // 0. Render-crash supervision, registered FIRST so a root crash reports
      //    to the host even if a later registration fails. On a root crash we
      //    ALSO render the 魂系复活覆盖层（右上角 ✕ 可关闭），而不是只默默上报。
      try {
        const disposeErr = slots.onEntryError((key, _entry, error) => {
          if (key !== 'root') return
          try {
            const message = error && error.message ? String(error.message) : String(error)
            fetch('/fuhuobi/api/render-error', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message }),
            }).catch(() => {})
            // 黑屏覆盖层：挂载到 document.body，独立于 DSH 的 slot 树。
            try {
              if (typeof document !== 'undefined' && !document.getElementById('fuhuobi-crash-overlay')) {
                const host = document.createElement('div')
                host.id = 'fuhuobi-crash-overlay'
                document.body.appendChild(host)
                const ReactDOM = require('react-dom/client') || require('react-dom')
                const root = ReactDOM.createRoot ? ReactDOM.createRoot(host) : null
                if (root) root.render(React.createElement(CrashOverlay, { message }))
              }
            } catch { /* 覆盖层失败不阻塞上报 */ }
          } catch { /* best effort */ }
        })
        if (typeof disposeErr === 'function') {
          ctx.effect(() => disposeErr, 'fuhuobi: entry error supervision')
        }
      } catch { /* older DSH without onEntryError: black-screen detection is best-effort */ }

      // 0b. Boot heartbeat (null-rendering occupant in an always-mounted slot).
      try {
        slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'fuhuobi-boot-heartbeat' },
          BootHeartbeat,
        ))
      } catch { /* best effort */ }

      // 0c. 报错界面提示（不遮挡报错）：在所有页面右下角注入一行小字，
      //     提示用户可用桌面/根目录的 DSH复活币X1 恢复。仅提示，不做按钮。
      try {
        slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'fuhuobi-error-hint', order: 9999 },
          () => React.createElement('div', {
            style: {
              position: 'fixed', right: '12px', bottom: '40px', zIndex: 9990,
              fontSize: '11px', color: 'rgba(140,132,120,.7)',
              background: 'rgba(20,16,12,.6)', padding: '6px 10px', borderRadius: '6px',
              pointerEvents: 'none', userSelect: 'none',
              fontFamily: 'ui-monospace, Consolas, "Courier New", monospace',
            },
          }, '💀 别慌，双击桌面「DSH复活币X1」即可恢复'),
        ))
      } catch { /* best effort */ }

      try { ctx.effect(installStyles) } catch { /* best effort */ }

      try {
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'fuhuobi-backups', order: 50, label: '复活币口袋' },
          BackupsSection,
        ))
      } catch { /* best effort */ }

      // 设置 > 插件 > 插件配置 card (rc.7), keyed on the `fuhuobi` namespace.
      try {
        const guardScope = ctx.settingsScope.bind({ namespace: 'fuhuobi' })
        ctx.effect(() =>
          slots.inject('settings.plugin.item', function* () {
            yield slots.register(
              {
                name: 'settings.plugin.item',
                key: 'fuhuobi',
                id: 'fuhuobi',
                order: 50,
                label: '复活币口袋（dsh-fuhuobi）',
                inject: () => ({ scope: guardScope }),
              },
              GuardCard,
            )
          }),
          'fuhuobi: plugin settings card',
        )
      } catch { /* best effort */ }
    }

    exports.apply = apply
    exports.inject = ['slots', 'settingsScope']
    return module.exports
  },
})
