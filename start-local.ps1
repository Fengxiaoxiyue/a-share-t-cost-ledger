param(
    [string]$UmiOcrPath = $env:UMI_OCR_PATH,
    [string]$BaseUrl = $(if ($env:UMI_OCR_BASE_URL) { $env:UMI_OCR_BASE_URL } else { "http://127.0.0.1:1224" })
)

$ErrorActionPreference = "Stop"
$serviceUri = [Uri]$BaseUrl
if ($serviceUri.Scheme -ne "http" -or $serviceUri.Host -notin @("127.0.0.1", "localhost")) {
    throw "为保护交易隐私，UMI_OCR_BASE_URL 只允许 127.0.0.1 或 localhost。"
}
$BaseUrl = $BaseUrl.TrimEnd("/")

function Test-UmiOcr {
    try {
        $result = Invoke-RestMethod -Uri "$BaseUrl/api/ocr/get_options" -TimeoutSec 2
        return $null -ne $result.'data.format'
    } catch { return $false }
}

if (-not (Test-UmiOcr)) {
    if (-not $UmiOcrPath -or -not (Test-Path -LiteralPath $UmiOcrPath)) {
        $programRoot = Join-Path $env:LOCALAPPDATA "Programs\Umi-OCR"
        if (Test-Path -LiteralPath $programRoot) {
            $UmiOcrPath = Get-ChildItem -LiteralPath $programRoot -Recurse -Filter "Umi-OCR.exe" |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
        }
    }
    if (-not $UmiOcrPath -or -not (Test-Path -LiteralPath $UmiOcrPath)) {
        throw "未找到 Umi-OCR。请先运行 scripts\install-umi-ocr.ps1，或设置 UMI_OCR_PATH。"
    }
    Start-Process -FilePath $UmiOcrPath -WorkingDirectory (Split-Path -Parent $UmiOcrPath) -WindowStyle Hidden
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-UmiOcr) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw "Umi-OCR 已启动，但本机 HTTP 服务未在 $BaseUrl 就绪。请检查全局设置中的 HTTP 服务、主机和端口。" }
}

$listener = Get-NetTCPConnection -LocalPort $serviceUri.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener -or $listener.LocalAddress -notin @("127.0.0.1", "::1")) {
    throw "Umi-OCR 没有仅监听本机地址，已停止打开交易工具。"
}

$indexPath = Join-Path $PSScriptRoot "index.html"
$indexUri = ([Uri]$indexPath).AbsoluteUri
$encodedBaseUrl = [Uri]::EscapeDataString($BaseUrl)
$toolUri = "$indexUri?umiOcrBaseUrl=$encodedBaseUrl"
$browserCandidates = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
)
$browserPath = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if ($browserPath) {
    Start-Process -FilePath $browserPath -ArgumentList @($toolUri)
} else {
    Start-Process -FilePath "explorer.exe" -ArgumentList @($toolUri)
}
Write-Host "Umi-OCR 已连接：$BaseUrl"
Write-Host "股票交易工具已打开。"
