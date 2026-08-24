# guard-launcher.ps1 - guarded launch entry for dsh-fuhuobi.
#
# Bridge between dsh-desktop-launcher and the revival-coin guarded boot:
#   launcher.ps1 invokes the dshCommand script as:
#     powershell -NoProfile -File guard-launcher.ps1 web [--profile X]
#   This script swallows those args and forwards to boot-guard.ps1, so a
#   desktop-icon double-click becomes a guarded boot: two-phase health check ->
#   auto-mint revival coin on success / auto-rollback on failure.
#   Note: no pre-boot snapshot is taken (the coin is only minted AFTER a
#   confirmed-good boot, so a bad state is never snapshotted as a coin).
#
# ASCII only: runs with Windows PowerShell 5.1 (no BOM).
#
# Exit code: passthrough of boot-guard.ps1 (0 = ok / 1 = failed).

param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$LauncherArgs
)

# Parse launcher args: `web` (ignored) and `--profile <name>` (forwarded).
$bootProfile = "web"
for ($i = 0; $i -lt $LauncherArgs.Count; $i++) {
    if ($LauncherArgs[$i] -eq '--profile' -and ($i + 1) -lt $LauncherArgs.Count) {
        $bootProfile = $LauncherArgs[$i + 1]
    }
}

$bootGuard = Join-Path $PSScriptRoot 'boot-guard.ps1'
if (-not (Test-Path $bootGuard)) {
    Write-Host "[DSH revival coin] boot-guard.ps1 not found (dsh-fuhuobi incomplete?)" -ForegroundColor Red
    exit 1
}

# Invoke the guarded-boot core.
& $bootGuard -Profile $bootProfile
exit $LASTEXITCODE
