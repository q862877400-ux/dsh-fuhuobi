@echo off
chcp 65001 >nul
set "LOG=D:\AI\work space\dsh-bie-beng\scripts\market-pr.log"
bash "D:\AI\work space\dsh-bie-beng\scripts\submit-market-pr.sh" > "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
rem 2=时间未到（跳过，保留任务等下次触发）；1=失败（保留日志）；0=成功（清理）
if "%RC%"=="2" (
  echo [skip] 收录时间未到，任务保留，等待下次触发。
  exit /b 0
)
if "%RC%"=="1" (
  echo [fail] 提交失败，日志保留在 %LOG% 供排查。
  exit /b 1
)
rem 成功：删除日志 + 删除定时任务（自我清理）
del /q "%LOG%" >nul 2>&1
schtasks /Delete /TN dsh-bie-beng-market-pr /F >nul 2>&1
echo [done] dsh-market 收录 PR 已提交，任务与日志已自动清理。
exit /b 0
