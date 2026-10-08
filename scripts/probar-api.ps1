# Prueba la API: crea una cuenta, inicia sesion y consulta /yo con el token.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\probar-api.ps1
#   (opcional) -Correo tu@correo.com -Password tu-contrasena

param(
  [string]$Correo = "prueba$(Get-Random -Maximum 99999)@enlaceseguro.mx",
  [string]$Password = 'contrasena-de-prueba',
  [string]$Api = 'http://127.0.0.1:8000'
)

function Llamar($Metodo, $Ruta, $Cuerpo, $Token) {
  $encabezados = @{}
  if ($Token) { $encabezados['Authorization'] = "Bearer $Token" }
  $parametros = @{ Method = $Metodo; Uri = "$Api$Ruta"; Headers = $encabezados; TimeoutSec = 30 }
  if ($Cuerpo) {
    $parametros['ContentType'] = 'application/json; charset=utf-8'
    $parametros['Body'] = [Text.Encoding]::UTF8.GetBytes(($Cuerpo | ConvertTo-Json))
  }
  try {
    return Invoke-RestMethod @parametros
  } catch {
    Write-Host "  Respuesta de error: $($_.ErrorDetails.Message)" -ForegroundColor Yellow
    return $null
  }
}

Write-Host "1. Registro de $Correo"
$usuario = Llamar 'Post' '/auth/registro' @{ nombre = 'Usuario de prueba'; correo = $Correo; password = $Password }
if ($usuario) { Write-Host "   Cuenta creada con id $($usuario.id)" -ForegroundColor Green }

Write-Host "2. Login con contrasena incorrecta (debe fallar con 401)"
$null = Llamar 'Post' '/auth/login' @{ correo = $Correo; password = 'incorrecta' }

Write-Host "3. Login correcto"
$sesion = Llamar 'Post' '/auth/login' @{ correo = $Correo; password = $Password }
if (-not $sesion) { exit 1 }
Write-Host "   Token recibido (expira en $($sesion.expiraEn) segundos)" -ForegroundColor Green

Write-Host "4. /yo sin token (debe fallar con 401)"
$null = Llamar 'Get' '/yo' $null $null

Write-Host "5. /yo con token"
$yo = Llamar 'Get' '/yo' $null $sesion.token
if ($yo) { Write-Host "   Hola, $($yo.nombre) <$($yo.correo)>" -ForegroundColor Green }
