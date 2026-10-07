# EnlaceSeguro

Aplicacion movil anti-smishing: revisa enlaces sospechosos con varias fuentes de
amenazas y los abre en un sandbox aislado para mostrar una vista previa segura.

Integrantes: Carlos Rafael Ruiz Ruiz y Arturo Yion Jaime.

## Estructura

- `sandbox/`: navegador aislado (Playwright + Fastify, TypeScript) que abre el enlace y regresa la captura.
- `api/`: API en Fastify con TypeScript (semana 2).
- `app/`: aplicacion movil en Flutter (semana 3).
- `docker-compose.yml`: levanta la base de datos y los 3 sandboxes.

## Levantar el proyecto

1. Copiar `.env.example` como `.env` y llenar la contrasena de la base de datos.
2. Ejecutar `docker compose up --build`.
3. Probar el sandbox 1 en `http://127.0.0.1:9001` con Postman o Insomnia.

## Contrato del sandbox

`POST /abrir` con `{"url": "https://..."}`

- `200`: analisis terminado. Campos: `urlInicial`, `urlFinal`, `redirecciones`,
  `titulo`, `formulariosPassword`, `descargaIntentada`, `archivoDescarga`,
  `peticionesBloqueadas`, `tiempoExcedido`, `errores`, `capturaPngBase64`,
  `peligro`, `motivos`.
- `400`: enlace invalido o direccion interna.
- `503`: el sandbox esta ocupado; intentar con otro.
- `504`: el analisis se congelo; el sandbox se reinicia.

Si `peligro` es `true`, el sandbox se cierra despues de responder y Docker lo
vuelve a levantar limpio.

`GET /salud` responde `{"ok": true, "ocupado": false}`.
