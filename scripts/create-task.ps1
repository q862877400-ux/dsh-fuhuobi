$ErrorActionPreference = "Stop"
$arg = '/c ""D:\AI\work space\dsh-bie-beng\scripts\run-market-pr.cmd""'
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $arg
$t1 = New-ScheduledTaskTrigger -Once -At "2026-08-24 09:00"
$t2 = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "dsh-bie-beng-market-pr" -Action $action -Trigger @($t1, $t2) -Description "dsh-market PR auto-submit (09:00 + at-login, self-cleans)" -Force | Out-Null
Write-Output "REGISTERED_OK"
