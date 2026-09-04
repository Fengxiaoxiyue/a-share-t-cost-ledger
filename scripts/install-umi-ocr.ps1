param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "Programs\Umi-OCR")
)

$ErrorActionPreference = "Stop"
$headers = @{ "User-Agent" = "a-share-t-cost-ledger-installer" }
$release = Invoke-RestMethod -Uri "https://api.github.com/repos/hiroi-sora/Umi-OCR/releases/latest" -Headers $headers
$asset = $release.assets | Where-Object { $_.name -match '^Umi-OCR_Rapid_.*\.7z\.exe$' } | Select-Object -First 1
if (-not $asset) { throw "官方最新稳定版中没有找到 Windows Rapid 安装包。" }

$checksumPattern = [regex]::Escape($asset.name) + '[\s\S]{0,300}?SHA256:\s*`?([a-fA-F0-9]{64})'
$checksumMatch = [regex]::Match([string]$release.body, $checksumPattern)
if (-not $checksumMatch.Success) { throw "官方发布说明中没有找到该安装包的 SHA-256，已停止安装。" }
$expectedHash = $checksumMatch.Groups[1].Value.ToUpperInvariant()

$downloadPath = Join-Path $env:TEMP $asset.name
Write-Host "正在从 Umi-OCR 官方 GitHub Release 下载 $($asset.name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $downloadPath -UseBasicParsing
$actualHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) { throw "安装包 SHA-256 校验失败，已停止安装。" }

$versionFolder = "Umi-OCR_Rapid_" + $release.tag_name.TrimStart("v")
$destination = Join-Path $InstallRoot $versionFolder
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$extract = Start-Process -FilePath $downloadPath -ArgumentList @("-y", "-o$destination") -WindowStyle Hidden -Wait -PassThru
if ($extract.ExitCode -ne 0) { throw "Umi-OCR 自解压失败，退出码 $($extract.ExitCode)。" }
$exe = Get-ChildItem -LiteralPath $destination -Recurse -Filter "Umi-OCR.exe" | Select-Object -First 1
if (-not $exe) { throw "解压后未找到 Umi-OCR.exe。" }

[Environment]::SetEnvironmentVariable("UMI_OCR_PATH", $exe.FullName, "User")
Write-Host "安装完成：$($exe.FullName)"
Write-Host "版本：$($release.tag_name)；引擎：Rapid；SHA-256：$actualHash"
