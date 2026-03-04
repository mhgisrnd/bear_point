# ========= 설정값(여기만 채우면 됨) =========
$LOCAL_URL       = "http://localhost:3000"

$CF_ACCOUNT_ID   = "564683de691a655ddcce0d0ff4fe9fdf"
$KV_NAMESPACE_ID = "47112b3f6e114d2ca6c42cfda22df8de"
$CF_API_TOKEN    = "_R-V7TA_qGyjGgN5JvR9_lHLodvoqzfbheoA4N3Q" #노출주의 필요

$KV_KEY = "target_url"
# ===========================================

# 현재 고정 URL
# 실행 시 로컬에 cloudflared 설치필요
# https://broken-limit-3fbc.kimjotea92.workers.dev/

function Set-KVValue([string]$value) {
  $api = "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces/$KV_NAMESPACE_ID/values/$KV_KEY"

  Invoke-RestMethod -Method Put -Uri $api `
    -Headers @{ "Authorization" = "Bearer $CF_API_TOKEN" } `
    -ContentType "text/plain" `
    -Body $value -ErrorAction Stop | Out-Null
}

# cloudflared 위치 찾기 (PATH에서)
$CLOUDFLARED = (Get-Command cloudflared -ErrorAction Stop).Source

Write-Host "[INFO] Starting cloudflared quick tunnel..."
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$logPath = Join-Path $logDir "cloudflared_latest.log"
if (Test-Path $logPath) { Remove-Item $logPath -Force -ErrorAction SilentlyContinue }

$job = Start-Job -ScriptBlock {
  param($exe, $localUrl, $log)
  & $exe tunnel --url $localUrl 2>&1 | Tee-Object -FilePath $log
} -ArgumentList $CLOUDFLARED, $LOCAL_URL, $logPath

$publicUrl = $null
$sw = [Diagnostics.Stopwatch]::StartNew()

while (-not $publicUrl -and $sw.Elapsed.TotalSeconds -lt 60) {
  if (Test-Path $logPath) {
    $text = Get-Content $logPath -Raw -ErrorAction SilentlyContinue
    if ($text -match "https://[A-Za-z0-9\-]+\.trycloudflare\.com/?") {
      $publicUrl = $Matches[0].TrimEnd("/")
      break
    }
  }
  Start-Sleep -Milliseconds 200
}

if (-not $publicUrl) {
  Write-Host "[ERROR] Could not detect trycloudflare URL within timeout."
  Write-Host "[INFO] Showing cloudflared output so far:"
  Receive-Job $job -Keep | Out-Host
  Stop-Job $job -Force | Out-Null
  Remove-Job $job | Out-Null
  exit 1
}

Write-Host "[OK] Public URL: $publicUrl"
Write-Host "[INFO] Updating KV key '$KV_KEY'..."
try {
  Set-KVValue $publicUrl
  Write-Host "[OK] KV updated. Fixed URL will now redirect correctly."
} catch {
  Write-Host "[ERROR] KV update failed: $($_.Exception.Message)"
  exit 1
}
Write-Host "[INFO] Keep this window open to keep tunnel alive."

# job이 계속 돌도록 대기 + 출력 표시
Wait-Job $job | Out-Null
#Receive-Job $job | Out-Host