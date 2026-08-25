# boot-guard.ps1 - guarded boot for DeepSeek Harness (Windows).
#
# Snapshots every profile, starts `dsh web`, health-checks it, and on failure
# kills the tree, rolls back to the last good snapshot and retries once.
# On first-attempt failure it also writes an incident report + pending marker
# (the guard plugin then auto-triggers analysis in the next session).
#
# Wire it into your launcher so the harness starts through this script:
#   powershell -NoProfile -ExecutionPolicy Bypass -File boot-guard.ps1
#
# On success the script stays attached to the server tree (Wait-Process), so
# launchers that kill the tree on window close keep their close-to-quit
# semantics; launchers that detach keep the server resident.
#
# ASCII only: runs with Windows PowerShell 5.1 (no BOM).

param(
    [int]$FirstWaitSec = 60,
    [int]$RetryWaitSec = 30,
    [int]$Port = 3080,
    [string]$Profile = "web",
    [string]$HarnessRoot = "",
    [string]$ServerArgs = "",
    [int]$RenderSettleSec = 20,
    [int]$RenderConfirmSec = 90
)

$ErrorActionPreference = "Continue"

# Force UTF-8 end-to-end for log files. Windows PowerShell 5.1's
# Add-Content/Set-Content default to the system ANSI code page (GBK on zh-CN)
# and decode native-child stdout with the console codepage, so Chinese in the
# guard CLI output becomes mojibake in the logs and incident reports. Pinning
# both sides to UTF-8 keeps every log valid UTF-8. The script file itself
# stays ASCII (PS 5.1 parses it as ANSI), only the log output is UTF-8.
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

if (-not $HarnessRoot) { $HarnessRoot = Split-Path -Parent $PSScriptRoot }
$HarnessRoot = $HarnessRoot.Trim().TrimEnd([char]34, [char]39, [char]92)  # strip stray quote/trailing slash
# DSH_HOME is where the harness keeps its profile/guard/launch state. Never
# derive it from $HarnessRoot (that is the plugin package dir, not the harness
# root) - doing so creates a junk empty data home and a fresh, config-less DSH.
# Prefer an explicit $env:DSH_HOME (expanding a leading "~" to $HOME), else
# default to the standard per-user location.
$dshHome = $env:DSH_HOME
if ($null -ne $dshHome) { $dshHome = $dshHome.Trim() }
if ([string]::IsNullOrEmpty($dshHome)) {
    $dshHome = Join-Path $HOME ".dsh"
} elseif ($dshHome.StartsWith("~")) {
    $dshTail = $dshHome.Substring(1).TrimStart([char]92, [char]47)  # strip leading "\" (92) or "/" (47)
    if ([string]::IsNullOrEmpty($dshTail)) { $dshHome = $HOME } else { $dshHome = Join-Path $HOME $dshTail }
}
$env:DSH_HOME = $dshHome

# Locate the guard CLI shipped inside the profile-rooted package. This is the
# only valid location; if it is absent the guard action is logged and skipped,
# never fatal.
$cli = Join-Path $env:DSH_HOME ("profiles\" + $Profile + "\node_modules\dsh-fuhuobi\scripts\guard-cli.js")

$logDir = Join-Path $env:DSH_HOME "guard\logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bootLog = Join-Path $logDir ("boot-" + $stamp + ".log")
$serverOut = Join-Path $logDir ("server-" + $stamp + ".out.log")
$serverErr = Join-Path $logDir ("server-" + $stamp + ".err.log")
$statusFile = Join-Path $logDir "last-boot.txt"

function Log([string]$msg) {
    Add-Content -Path $bootLog -Value ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg) -Encoding UTF8
}
function Set-Status([string]$status, [string]$note) {
    ("{0} {1} {2} {3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $status, $note, "(log: $stamp)") |
        Set-Content -Path $statusFile -Encoding UTF8
}
function Test-Health {
    try {
        $r = Invoke-WebRequest -Uri ("http://127.0.0.1:$Port/") -TimeoutSec 3 -UseBasicParsing
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch { return $false }
}
function Invoke-Guard([string[]]$cliArgs) {
    if (-not (Test-Path $cli)) {
        Log ("guard-cli not found at " + $cli + " - skipping guard action")
        return ""
    }
    $out = & node $cli @cliArgs 2>&1 | Out-String
    if ($out) { foreach ($line in ($out -split "`r?`n")) { if ($line.Trim()) { Log ("  [guard] " + $line.Trim()) } } }
    return $out
}
function Is-Alive([System.Diagnostics.Process]$p) {
    if ($null -eq $p) { return $false }
    try { $p.Refresh() } catch {}
    return (-not $p.HasExited)
}
function Wait-Healthy([int]$seconds, [System.Diagnostics.Process]$proc) {
    # Returns "ok" (healthy), "crashed" (the server process already exited, so
    # roll back immediately instead of waiting out the timeout), or "timeout"
    # (still running but never became healthy within $seconds).
    # The crash branch requires BOTH an unhealthy check AND a dead process, so
    # a server that hands off to a detached healthy child is never rolled back.
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Health) { return "ok" }
        if (-not (Is-Alive $proc)) { return "crashed" }
        Start-Sleep -Milliseconds 250
    }
    return "timeout"
}
function Format-Args([object[]]$argsList) {
    # Build a single argument string for Start-Process -ArgumentList. PS 5.1
    # uses the .NET Framework ProcessStartInfo, which has no ArgumentList, and
    # Start-Process does not quote array elements on its own, so paths with
    # spaces get split. Wrap every arg that contains whitespace (or is empty)
    # in double quotes and double any embedded double quotes as the target
    # command-line parser expects.
    if ($null -eq $argsList -or $argsList.Count -eq 0) { return "" }
    $quoted = @()
    foreach ($a in $argsList) {
        $s = [string]$a
        if ($s -eq "" -or $s -match '\s') {
            $s = '"' + ($s -replace '"', '""') + '"'
        }
        $quoted += $s
    }
    return ($quoted -join " ")
}

function Start-Server([string]$outLog, [string]$errLog) {
    # 1) Launch manifest (authoritative). The fuhuobi plugin rewrites
    #    <DSH_HOME>\guard\launch.json after every confirmed-good boot, so it
    #    wins over guessing how this harness was installed (source checkout
    #    launched via `pnpm dsh` has no dsh.cmd and no `dsh` on PATH).
    $manifestPath = Join-Path $env:DSH_HOME ("guard\launch.json")
    if (Test-Path $manifestPath) {
        try {
            $m = Get-Content -Path $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $m -and -not [string]::IsNullOrEmpty([string]$m.file)) {
                $argsList = @()
                if ($m.args -is [array]) { $argsList = $m.args } elseif ($null -ne $m.args) { $argsList = @($m.args) }
                $argStr = Format-Args $argsList
                $cwd = [string]$HarnessRoot
                if (-not [string]::IsNullOrEmpty([string]$m.cwd)) { $cwd = [string]$m.cwd }
                if ($m.viaShell) {
                    $cmdLine = '"' + $m.file + '"'
                    if ($argStr -ne "") { $cmdLine = $cmdLine + " " + $argStr }
                    return (Start-Process -FilePath "cmd.exe" `
                        -ArgumentList '/d', '/s', '/c', $cmdLine `
                        -WorkingDirectory $cwd `
                        -RedirectStandardOutput $outLog `
                        -RedirectStandardError $errLog `
                        -WindowStyle Hidden `
                        -PassThru)
                } else {
                    $spArgs = @{ FilePath = [string]$m.file; WorkingDirectory = $cwd; RedirectStandardOutput = $outLog; RedirectStandardError = $errLog; WindowStyle = "Hidden"; PassThru = $true }
                    if ($argStr -ne "") { $spArgs.Add("ArgumentList", $argStr) }
                    return (Start-Process @spArgs)
                }
            }
        } catch {
            Log ("launch manifest present but could not be parsed: " + $_.Exception.Message + " - falling back to PATH/harness layout")
        }
    }

    # 2) `dsh` on PATH (e.g. an installed CLI). Run through a shell so PATH
    #    resolution and any .cmd wrapper behave like a normal console launch.
    if (Get-Command dsh -ErrorAction SilentlyContinue) {
        $cmdLine = "dsh web"
        if ($ServerArgs.Trim() -ne "") { $cmdLine = $cmdLine + " " + $ServerArgs.Trim() }
        return (Start-Process -FilePath "cmd.exe" `
            -ArgumentList '/d', '/s', '/c', $cmdLine `
            -WorkingDirectory $HarnessRoot `
            -RedirectStandardOutput $outLog `
            -RedirectStandardError $errLog `
            -WindowStyle Hidden `
            -PassThru)
    }

    # 3) Legacy harness-root dsh.cmd layout.
    $dshCmd = Join-Path $HarnessRoot "node_modules\.bin\dsh.cmd"
    if (Test-Path $dshCmd) {
        $cmdLine = '"' + $dshCmd + '" web'
        if ($ServerArgs.Trim() -ne "") { $cmdLine = $cmdLine + " " + $ServerArgs.Trim() }
        return (Start-Process -FilePath "cmd.exe" `
            -ArgumentList '/d', '/s', '/c', $cmdLine `
            -WorkingDirectory $HarnessRoot `
            -RedirectStandardOutput $outLog `
            -RedirectStandardError $errLog `
            -WindowStyle Hidden `
            -PassThru)
    }

    # 4) Nothing to launch with: no manifest and no resolvable launcher.
    Log "no launch manifest and no dsh on PATH - boot DSH once from the CLI so <DSH_HOME>\guard\launch.json gets written"
    return $null
}
function Stop-ServerTree($p) {
    if ($p -and -not $p.HasExited) {
        try { & taskkill /PID $p.Id /T /F 2>&1 | Out-Null } catch {}
        try { $p.Kill() } catch {}
    }
}

function Test-RenderReady([int]$seconds) {
    # After HTTP is up, confirm the web client actually rendered. The fuhuobi
    # client POSTs /fuhuobi/api/booted on a successful root mount and
    # /fuhuobi/api/render-error on a root render crash (rc.7 "page opens but
    # black screen with an error"). HTTP / alone cannot tell these apart.
    # - JSON with renderError true  -> "rendercrash" (roll back)
    # - JSON with booted true       -> "ok" (client really rendered)
    # - JSON with booted false      -> keep polling (client not rendered yet)
    # - non-JSON response (the webServer catch-all serves the SPA HTML for
    #      unmatched paths)         -> "ok": the guard endpoint is not mounted
    #      (old guard / not installed) -> HTTP-only, old behavior
    # - deadline reached            -> "unconfirmed" (no heartbeat, no crash:
    #      the app may be stuck on a boot screen without reporting a root
    #      error; the caller decides how to treat the ambiguity)
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $resp = $null
        try {
            $resp = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $Port + "/fuhuobi/api/render-error") -TimeoutSec 2 -UseBasicParsing
        } catch {
            $status = $_.Exception.Response.StatusCode
            if ($status -eq [System.Net.HttpStatusCode]::NotFound) { return "ok" }
            # other failures (busy/recovering): keep polling
        }
        if ($resp) {
            $parsed = $null
            try { $parsed = $resp.Content | ConvertFrom-Json } catch { $parsed = $null }
            $hasSignal = ($null -ne $parsed) -and (
                ($parsed.PSObject.Properties.Name -contains 'renderError') -or
                ($parsed.PSObject.Properties.Name -contains 'booted'))
            if (-not $hasSignal) { return "ok" }  # not the guard endpoint (HTML fallback / old guard)
            if ($parsed.renderError) { return "rendercrash" }
            if ($parsed.booted) { return "ok" }
        }
        Start-Sleep -Milliseconds 500
    }
    return "unconfirmed"
}

function Confirm-RenderReady {
    # Two-phase render confirmation. Phase 1 is a short settle; if it yields
    # nothing, phase 2 waits much longer because the launcher (launch.vbs)
    # opens the browser only AFTER the server answers - so a healthy render can
    # legitimately arrive tens of seconds after HTTP 200.
    # Returns "ok" | "rendercrash" | "unconfirmed".
    # -RenderSettleSec 0 disables the render check (headless/server-only boots).
    if ($RenderSettleSec -le 0) { return "ok" }
    $r = Test-RenderReady $RenderSettleSec
    if ($r -ne "unconfirmed") { return $r }
    if ($RenderConfirmSec -le 0) { return "unconfirmed" }
    Log ("client readiness unconfirmed after " + $RenderSettleSec + " s; extending " + $RenderConfirmSec + " s for the launcher to open the page")
    return Test-RenderReady $RenderConfirmSec
}

Log "=== boot guard start ==="
if (Test-Health) { Log "already healthy"; Set-Status "OK" "already-running"; exit 0 }

$proc = Start-Server $serverOut $serverErr
if ($null -eq $proc) {
    Log "no server process could be started (no launch manifest and no dsh on PATH) - skipping health check"
    $boot = "nostart"
} else {
    Log "started server (pid $($proc.Id))"
    $boot = Wait-Healthy $FirstWaitSec $proc
}
if ($boot -eq "ok") {
    # HTTP is up; confirm the web client actually rendered (rc.7 black-screen /
    # stuck-boot detection). A render crash or a never-ready client rolls back
    # just like a dead server.
    $render = Confirm-RenderReady
    if ($render -eq "ok") {
        Log "boot ok on first attempt"
        Set-Status "OK" "first-attempt"
        # Two-phase health check passed: auto-mint a revival coin (3-level rotation).
        $null = Invoke-Guard @("revive-coin", "--mark")
        Wait-Process -Id $proc.Id
        Log "server tree exited; boot guard done"
        exit 0
    }
    if ($render -eq "rendercrash") {
        Log "client render crash detected; stopping and rolling back"
    } else {
        Log "client readiness unconfirmed after up to $($RenderSettleSec + $RenderConfirmSec) s (no render heartbeat, no render crash) - treating as failed and rolling back"
    }
    $boot = "rendercrash"
} else {
    Log "server not healthy ($boot) after up to $FirstWaitSec s; stopping and rolling back"
}
Stop-ServerTree $proc

$null = Invoke-Guard @("rollback", "--good")

$proc2 = Start-Server $serverOut $serverErr
if ($null -eq $proc2) {
    Log "no server process could be started on retry - skipping health check"
    $retry = "nostart"
} else {
    Log "restarted server (pid $($proc2.Id))"
    $retry = Wait-Healthy $RetryWaitSec $proc2
}
if ($retry -eq "ok") {
    $retryRender = Confirm-RenderReady
    if ($retryRender -ne "ok") { $retry = "rendercrash" }
}
if ($retry -eq "ok") {
    Set-Status "OK" "rolled-back-retry"
    $null = Invoke-Guard @("revive-coin", "--mark")
} else {
    Stop-ServerTree $proc2
    Set-Status "FAILED" ("boot-failed (" + $retry + ")")
    Log "rollback did not fix the boot; diagnosing the offending plugin for quarantine"
    $diag = Invoke-Guard @("quarantine", "--diagnose")
    $culprit = ""
    foreach ($line in ($diag -split "`r?`n")) {
        if ($line -match '^CULPRIT=(\S+)$') { $culprit = $Matches[1] }
    }
    if ($culprit -ne "" -and $culprit -ne "NONE") {
        Log "culprit plugin identified: $culprit - disabling it and booting without it"
        $null = Invoke-Guard @("quarantine", "--plugin", $culprit)
        $proc3 = Start-Server $serverOut $serverErr
        if ($null -eq $proc3) {
            Log "no server process could be started after quarantine - skipping health check"
            $qBoot = "nostart"
        } else {
            Log "restarted server without $culprit (pid $($proc3.Id))"
            $qBoot = Wait-Healthy $RetryWaitSec $proc3
        }
        if ($qBoot -eq "ok") {
            $qRender = Confirm-RenderReady
            if ($qRender -ne "ok") { $qBoot = "rendercrash" }
        }
        if ($qBoot -eq "ok") {
            Log "boot ok after quarantining $culprit"
            Set-Status "QUARANTINED" ("$culprit incompatible with current DSH: rollback cannot fix it; disabled and booting without it")
            Wait-Process -Id $proc3.Id
            Log "server tree exited; boot guard done (plugin quarantined)"
            exit 0
        }
        Stop-ServerTree $proc3
        Set-Status "FAILED" ("boot-failed-after-quarantine (" + $qBoot + ")")
        Log "still not healthy after quarantining $culprit"
    } else {
        Log "no quarantineable plugin identified from the boot logs; keeping the failure report"
    }
}

$null = Invoke-Guard @("incident", "--kind", "boot-failure")

# Boot failed completely: CLI hint to revive via the revival coin (route 3,
# for when the web page cannot open at all). ASCII only (PS 5.1, no BOM).
Write-Host ""
Write-Host "==================================================" -ForegroundColor DarkYellow
Write-Host " [DSH Revival Coin] Boot failed!" -ForegroundColor Red
Write-Host " Double-click DSHReviveCoinX1.cmd on the desktop or in the DSH" -ForegroundColor Yellow
Write-Host " root, or run: dsh-fuhuobi revive-coin" -ForegroundColor Yellow
Write-Host "==================================================" -ForegroundColor DarkYellow
Write-Host ""

if ($retry -eq "ok") { Wait-Process -Id $proc2.Id; Log "server tree exited; boot guard done"; exit 0 }
exit 1
