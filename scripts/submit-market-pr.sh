#!/usr/bin/env bash
# 自动提交 dsh-market 收录 PR（awesome-dsh-plugin 仓库）
# 由 Windows 任务计划定时触发；幂等：已存在 PR 则跳过
set -euo pipefail

export PATH="$PATH:/c/Program Files/GitHub CLI:/c/Program Files/nodejs:/c/Program Files/Git/usr/bin"
log() { echo "[$(date "+%F %T")] $*"; }

log "== dsh-market 收录 PR 自动提交 =="

# 0) 认证检查
gh auth status > /dev/null 2>&1 || { log "✗ gh 未认证，中止"; exit 1; }
ME=$(gh api user --jq .login)
log "GitHub 用户: $ME"

# 1.5) 收录时间门：仓库需 ≥1 天（fork 创建于 2026-08-23），最早 2026-08-24 01:00 后提交
EARLIEST="20260824T010000"
NOW=$(date +%Y%m%dT%H%M%S)
if [[ "$NOW" < "$EARLIEST" ]]; then
  log "收录时间未到（需 2026-08-24 01:00 之后），跳过本次（任务保留，等待下次触发）"
  exit 2
fi

# 1) 幂等：已有同名 PR 则跳过
if gh pr list --repo awesome-dsh-plugin/awesome-dsh-plugin --head "$ME:add-dsh-bie-beng" --state open --json number --jq ".length" 2>/dev/null | grep -q "^[1-9]"; then
  log "已存在收录 PR（目标已达成）"; exit 0
fi

# 2) fork 收录仓库（若未 fork）
if ! gh api "repos/$ME/awesome-dsh-plugin" > /dev/null 2>&1; then
  log "fork awesome-dsh-plugin ..."
  gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=false
  for i in $(seq 1 30); do gh api "repos/$ME/awesome-dsh-plugin" > /dev/null 2>&1 && break; sleep 5; done
fi

# 3) clone 自己的 fork 到临时目录
TMP=$(mktemp -d)
trap "rm -rf \"$TMP\"" EXIT
git clone --depth 1 "https://github.com/$ME/awesome-dsh-plugin.git" "$TMP/repo" 2>/dev/null || { log "✗ clone 失败"; exit 1; }
cd "$TMP/repo"
git config user.name "$ME"
git config user.email "$ME@users.noreply.github.com"
git checkout -b add-dsh-bie-beng 2>/dev/null || true

# 4) 写入收录条目
mkdir -p data/plugins
cat > "data/plugins/${ME}__dsh-bie-beng.yml" <<'EOF'
url: https://github.com/q862877400-ux/dsh-bie-beng
name: q862877400-ux/dsh-bie-beng
category: dev
description:
  en: Install safety net for DeepSeek Harness: pre-install snapshots, guarded boot with auto-rollback, desktop one-click recovery, bad-plugin quarantine, and incident reports.
  zh: 插件别崩！！装插件翻车？自动快照、启动体检、崩了自动回滚，桌面一键救回，坏插件自动隔离。
EOF
log "条目已写入 data/plugins/${ME}__dsh-bie-beng.yml"

# 5) 刷新 README（收录仓库规则要求；脚本不存在则跳过）
if [ -f scripts/generate-readme.mjs ]; then node scripts/generate-readme.mjs || log "⚠ generate-readme 失败，继续"; fi

# 6) commit + push
git add -A
git -c user.name="$ME" -c user.email="$ME@users.noreply.github.com" commit -m "Add dsh-bie-beng · 插件别崩！！" 2>/dev/null || { log "无改动可提交"; exit 0; }
git push -u origin add-dsh-bie-beng 2>&1 | tail -2

# 7) 创建 PR
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin --base main --head "$ME:add-dsh-bie-beng" \
  --title "Add dsh-bie-beng（插件别崩！！）—— DSH 插件安装安全网" \
  --body "收录 dsh-bie-beng（fork 自 dsh-plugin-guard）：安装前自动快照、守护启动自动回滚、桌面一键回滚按钮、坏插件隔离、事故报告。带 dsh-plugin topic。PR gate 通过后每日刷新进 dsh-market。" \
  --label "" 2>/dev/null | tail -2
log "✅ PR 已提交"