#!/usr/bin/env bash
# 一键：fork 上游 → 推送分支 → 打 dsh-plugin topic（需 gh 已认证：gh auth login）
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH="feat/desktop-button-zh"

echo "== 1) 检查 gh 认证 =="
gh auth status || { echo "请先运行: gh auth login（浏览器授权）"; exit 1; }

ME=$(gh api user --jq .login)
echo "GitHub 用户: $ME"

echo "== 2) fork 上游（若未 fork）=="
if ! gh api "repos/$ME/dsh-plugin-guard" > /dev/null 2>&1; then
  gh repo fork lxzy-7/dsh-plugin-guard --clone=false --remote=false
  echo "已发起 fork，等待仓库就绪..."
  for i in $(seq 1 30); do
    gh api "repos/$ME/dsh-plugin-guard" > /dev/null 2>&1 && break
    sleep 5
  done
else
  echo "fork 已存在"
fi

echo "== 3) 推送分支 =="
git remote remove fork 2>/dev/null || true
git remote add fork "https://github.com/$ME/dsh-plugin-guard.git"
git push -u fork "$BRANCH"

echo "== 4) 打 dsh-plugin topic（自动被发现/收录）=="
gh repo edit "$ME/dsh-plugin-guard" --add-topic dsh-plugin
gh repo edit "$ME/dsh-plugin-guard" --add-topic dsh

echo
echo "✅ 完成！你的 fork: https://github.com/$ME/dsh-plugin-guard (分支 $BRANCH)"
echo "可选：对上游开 PR —— gh pr create --repo lxzy-7/dsh-plugin-guard --head $ME:$BRANCH"
echo "可选：发布 npm —— 在仓库根目录 npm login 后执行 npm publish（改 package.json name）"