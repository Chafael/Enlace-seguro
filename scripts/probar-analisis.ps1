# Prueba el flujo completo: inicia sesion, manda un enlace (o un mensaje completo),
# espera el veredicto, abre la captura y muestra el historial.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\probar-analisis.ps1 -Texto "https://example.com"
#   powershell -ExecutionPolicy Bypass -File scripts\probar-analisis.ps1 -Texto "Tu paquete esta retenido, paga en bit.ly/abc"

param(
  [Parameter(Mandatory = $true)][string]$Texto,
  [string]$Correo = 'demo@enlaceseguro.mx',
  [string]$Password = 'contrasena-demo',
  [string]$Api = 'http://127.0.0.1:8000'
)

function Llamar($Metodo, $Ruta, $Cuerpo, $Token) {
  $parametros = @{ Method = $Metodo; Uri = "$Api$Ruta"; TimeoutSec = 30 }
  if ($Token) { $parametros['Headers'] = @{ Authorization = "Bearer $Token" } }
  if ($Cuerpo) {
    $parametros['ContentType'] = 'application/json; charset=utf-8'
    $parametros['Body'] = [Text.Encoding]::UTF8.GetBytes(($Cuerpo | ConvertTo-Json))
  }
  try {
    return Invoke-RestMethod @parametros
  } catch {
    $script:ultimoError = $_.ErrorDetails.Message
    return $null
  }
}

# 1. Cuenta de demostracion (si ya existe, el registro responde 409 y se ignora)
$null = Llamar 'Post' '/auth/registro' @{ nombre = 'Demo'; correo = $Correo; password = $Password }
$sesion = Llamar 'Post' '/auth/login' @{ correo = $Correo; password = $Password }
if (-not $sesion) { Write-Host "No se pudo iniciar sesion: $ultimoError" -ForegroundColor Red; exit 1 }
$token = $sesion.token

# 2. Mandar el enlace
$analisis = Llamar 'Post' '/analisis' @{ texto = $Texto } $token
if (-not $analisis) { Write-Host "No se pudo crear el analisis: $ultimoError" -ForegroundColor Red; exit 1 }
Write-Host "Enlace detectado: $($analisis.url)"
Write-Host -NoNewline "Analizando"

# 3. Esperar el resultado (la app hara lo mismo cada 2 segundos)
do {
  Start-Sleep -Seconds 2
  Write-Host -NoNewline '.'
  $r = Llamar 'Get' "/analisis/$($analisis.id)" $null $token
} while ($r -and $r.estado -in @('pendiente', 'procesando'))
Write-Host ''

if ($r.estado -eq 'error') {
  Write-Host "Error: $($r.razones -join ' ')" -ForegroundColor Red
  exit 1
}

$color = @{ seguro = 'Green'; sospechoso = 'Yellow'; peligroso = 'Red' }[$r.veredicto]
Write-Host "VEREDICTO: $($r.veredicto.ToUpper())" -ForegroundColor $color
$r.razones | ForEach-Object { Write-Host "  - $_" }
if ($r.urlFinal -and $r.urlFinal -ne $r.url) { Write-Host "Direccion final: $($r.urlFinal)" }
if ($r.desdeCache) { Write-Host '(resultado reutilizado de un analisis reciente del mismo enlace)' }

# 4. Captura
if ($r.captura) {
  $ruta = Join-Path (Get-Location) "captura-$(Get-Date -Format 'HHmmss').png"
  [IO.File]::WriteAllBytes($ruta, [Convert]::FromBase64String($r.captura))
  Write-Host "Captura guardada en $ruta"
  Start-Process $ruta
}

# 5. Historial
Write-Host ''
Write-Host 'Ultimos analisis:'
$historial = Llamar 'Get' '/historial?limite=5' $null $token
foreach ($analisisPrevio in $historial) {
  Write-Host ("  {0,-11} {1}" -f $analisisPrevio.veredicto, $analisisPrevio.url)
}
