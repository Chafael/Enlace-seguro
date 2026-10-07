# Prueba el sandbox desde PowerShell: manda un enlace, muestra el resultado
# y abre la captura.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\probar-sandbox.ps1 -Url https://example.com
#   (opcional) -Puerto 9001

param(
  [Parameter(Mandatory = $true)][string]$Url,
  [int]$Puerto = 9001
)

$cuerpo = @{ url = $Url } | ConvertTo-Json

try {
  $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Puerto/abrir" `
    -ContentType 'application/json' -Body $cuerpo -TimeoutSec 60
} catch {
  Write-Host "El sandbox respondio con error:" -ForegroundColor Red
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message } else { Write-Host $_.Exception.Message }
  exit 1
}

Write-Host "Titulo:          $($r.titulo)"
Write-Host "Direccion final: $($r.urlFinal)"
Write-Host "Redirecciones:   $($r.redirecciones -join '  ->  ')"
Write-Host "Contrasenas:     $($r.formulariosPassword)"
Write-Host "Descarga:        $($r.descargaIntentada) $($r.archivoDescarga)"
Write-Host "Bloqueadas:      $($r.peticionesBloqueadas -join ', ')"

if ($r.peligro) {
  Write-Host "PELIGRO:" -ForegroundColor Red
  $r.motivos | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
  Write-Host "El sandbox se cerrara y Docker lo levantara limpio."
} else {
  Write-Host "Sin peligro detectado por el sandbox." -ForegroundColor Green
}

if ($r.capturaPngBase64) {
  $ruta = Join-Path (Get-Location) "captura-$(Get-Date -Format 'HHmmss').png"
  [IO.File]::WriteAllBytes($ruta, [Convert]::FromBase64String($r.capturaPngBase64))
  Write-Host "Captura guardada en $ruta"
  Start-Process $ruta
}
