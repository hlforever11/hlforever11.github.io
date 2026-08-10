[CmdletBinding()]
param(
    [switch]$Startup,
    [switch]$NoOpenSite
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$WindowsFolder = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendFolder = Split-Path -Parent $WindowsFolder
$VenvFolder = Join-Path $BackendFolder ".venv-local"
$Python = Join-Path $VenvFolder "Scripts\python.exe"
$PidFile = Join-Path $WindowsFolder "backend.pid"
$StdoutLog = Join-Path $WindowsFolder "backend-output.log"
$StderrLog = Join-Path $WindowsFolder "backend-error.log"
$PublicUrlFile = Join-Path $WindowsFolder "public-url.txt"
$HealthUrl = "http://127.0.0.1:10000/health"

function Find-Tailscale {
    $Command = Get-Command "tailscale.exe" -ErrorAction SilentlyContinue
    if ($null -ne $Command) {
        return $Command.Source
    }
    $InstalledPath = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
    if (Test-Path $InstalledPath) {
        return $InstalledPath
    }
    return $null
}

function Test-BackendHealth {
    try {
        $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
        return $Health.status -eq "ok"
    } catch {
        return $false
    }
}

if (-not (Test-Path $Python)) {
    if ($Startup) { exit 1 }
    throw "尚未安装本机后端。请先双击 setup-local-backend.cmd。"
}

$MachinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$(Join-Path $VenvFolder 'Scripts');$MachinePath;$UserPath"
$env:CORS_ORIGINS = "https://hlforever11.github.io"
$env:YOUTUBE_PLAYER_CLIENTS = "web_safari,web_embedded,android_vr"
$env:POT_PROVIDER_URL = ""
$env:MAX_DURATION_SECONDS = "1800"
$env:MAX_FILE_BYTES = "262144000"
$env:MAX_JOB_SECONDS = "900"

if (-not (Test-BackendHealth)) {
    if (Test-Path $PidFile) {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    $Arguments = @(
        "-m", "uvicorn", "app:app",
        "--host", "127.0.0.1",
        "--port", "10000",
        "--proxy-headers",
        "--forwarded-allow-ips", "127.0.0.1"
    )
    $Process = Start-Process `
        -FilePath $Python `
        -ArgumentList $Arguments `
        -WorkingDirectory $BackendFolder `
        -WindowStyle Hidden `
        -RedirectStandardOutput $StdoutLog `
        -RedirectStandardError $StderrLog `
        -PassThru
    Set-Content -Path $PidFile -Value $Process.Id -Encoding ascii

    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
        Start-Sleep -Seconds 1
        if (Test-BackendHealth) {
            $Ready = $true
            break
        }
        if ($Process.HasExited) {
            break
        }
    }
    if (-not $Ready) {
        if ($Startup) { exit 1 }
        throw "后端没有成功启动。请把 windows\backend-error.log 发给我。"
    }
}

if (-not $Startup) {
    Write-Host "本机后端已运行：$HealthUrl" -ForegroundColor Green
}

$Tailscale = Find-Tailscale
if ($null -eq $Tailscale) {
    if ($Startup) { exit 1 }
    throw "未找到 Tailscale。请先运行 setup-local-backend.cmd。"
}

$FunnelArguments = @("funnel", "--bg", "--https=443", "http://127.0.0.1:10000")
$FunnelOutput = (& $Tailscale $FunnelArguments 2>&1 | Out-String)
$FunnelExitCode = $LASTEXITCODE

if ($FunnelExitCode -ne 0 -and -not $Startup) {
    $ApprovalMatch = [regex]::Match($FunnelOutput, "https://login\.tailscale\.com/[^\s]+")
    if ($ApprovalMatch.Success) {
        Write-Host "需要在浏览器确认一次公开访问权限。" -ForegroundColor Yellow
        Start-Process $ApprovalMatch.Value
        Read-Host "浏览器中启用 Funnel 后，回到这里按 Enter"
        $FunnelOutput = (& $Tailscale $FunnelArguments 2>&1 | Out-String)
        $FunnelExitCode = $LASTEXITCODE
    }
}

if ($FunnelExitCode -ne 0) {
    if ($Startup) { exit 1 }
    Write-Host $FunnelOutput
    throw "Tailscale Funnel 未能启用。请把上面的信息截图发给我。"
}

$StatusOutput = (& $Tailscale funnel status 2>&1 | Out-String)
$UrlMatch = [regex]::Match($StatusOutput, "https://[A-Za-z0-9.-]+\.ts\.net")
if (-not $UrlMatch.Success) {
    $UrlMatch = [regex]::Match($FunnelOutput, "https://[A-Za-z0-9.-]+\.ts\.net")
}

if ($UrlMatch.Success) {
    Set-Content -Path $PublicUrlFile -Value $UrlMatch.Value.TrimEnd('/') -Encoding ascii
    if (-not $Startup) {
        Write-Host "公网 HTTPS 地址：$($UrlMatch.Value.TrimEnd('/'))" -ForegroundColor Green
        Write-Host "地址也已保存到 windows\public-url.txt。"
    }

    if (-not $Startup -and -not $NoOpenSite) {
        Start-Process "https://hlforever11.github.io/youtube-downloader/"
    }
} elseif (-not $Startup) {
    Write-Host $StatusOutput
    throw "Funnel 已启动，但没有识别到公网地址。请把上面的状态截图发给我。"
}
