@echo off
rem DSH复活币X1.cmd — 双击即可恢复 DSH 至上次成功启动的状态（一键复活）。
rem
rem 恢复流程：读取 $DSH_HOME/guard/revive-coin.json 中的当前复活币快照，
rem 还原所有 profile 的配置文件（package.json、锁文件、pnpm-workspace.yaml、
rem cordis.patch.yml），然后运行 pnpm install --frozen-lockfile。
rem 任何情况下都安全：应用完全起不来时也能用；恢复本身可逆（恢复前
rem 会自动先存一份 pre-rollback 快照）。
rem
rem DSH_HOME 定位顺序：
rem   1) DSH_HOME 环境变量（由你的启动器设置）
rem   2) 由本文件自身位置推导（<scriptdir>\..\..\..\..\.. = $DSH_HOME/profiles/<profile>/node_modules/dsh-fuhuobi/scripts）
rem   3) 默认 ~/.dsh

setlocal
chcp 65001 >nul

rem 1) 从脚本位置推导 DSH_HOME
if "%DSH_HOME%"=="" (
  if exist "%~dp0..\..\..\..\..\profiles" set "DSH_HOME=%~dp0..\..\..\..\.."
)

rem 2) 定位 dsh-fuhuobi 的 CLI
set "CLI="
if defined DSH_HOME (
  if exist "%DSH_HOME%\profiles\web\node_modules\dsh-fuhuobi\scripts\guard-cli.js" set "CLI=%DSH_HOME%\profiles\web\node_modules\dsh-fuhuobi\scripts\guard-cli.js"
)
if not defined CLI if exist "%~dp0guard-cli.js" set "CLI=%~dp0guard-cli.js"

echo.
echo ==============================================
echo    DSH 复活币 X1
echo  双击此文件可恢复 DSH 至上次成功启动状态
echo ==============================================
echo.

set "RC=1"
if defined CLI (
  node "%CLI%" revive-coin --use
  set "RC=%ERRORLEVEL%"
) else (
  echo [DSH 复活币] 找不到 guard-cli.js，请确认 dsh-fuhuobi 已安装。
  echo 若 DSH_HOME 未设置，请设置后重试。
)

echo.
if "%RC%"=="0" (
  echo 复活成功！请重启 DSH。
  echo （复活本身可逆：恢复前已自动存了一份 pre-rollback 快照。）
) else (
  echo 复活失败，请查看上方错误信息。
)
echo.
pause
endlocal & exit /b %RC%
