# EnlaceSeguro

Aplicacion movil anti-smishing: revisa enlaces sospechosos con varias fuentes de
amenazas y los abre en un sandbox aislado para mostrar una vista previa segura.

Integrantes: Carlos Rafael Ruiz Ruiz y Arturo Yion Jaime.

## Estructura

- `sandbox/`: navegador aislado (Playwright + Fastify, TypeScript) que abre el enlace y regresa la captura.
- `api/`: API en Fastify con TypeScript: usuarios, login con JWT, fila de analisis y veredicto.
  Documentacion en `http://127.0.0.1:8000/docs`.
- `api/src/analisis/`: integracion con los sandboxes y contrato con las fuentes de amenazas.
- `app/`: aplicacion movil en Flutter (semana 4).
- `docker-compose.yml`: levanta la base de datos, la API y los 3 sandboxes.

## Levantar el proyecto

1. Copiar `.env.example` como `.env` y llenar la contrasena de la base de datos y `JWT_SECRET`.
2. Ejecutar `docker compose up --build -d`.
3. Probar con `scripts\probar-analisis.ps1 -Texto "https://example.com"`.

## Contrato de la API

Autenticacion:

- `POST /auth/registro` con `{"nombre", "correo", "password"}`: `201` con `{id, nombre, correo}`;
  `409` si el correo ya existe; `400` si los datos no son validos.
- `POST /auth/login` con `{"correo", "password"}`: `200` con `{token, tipo, expiraEn}`;
  `401` si el correo o la contrasena son incorrectos; `429` despues de 5 intentos por minuto.
- `GET /yo`: `200` con `{id, nombre, correo, creadoEn}`.

Analisis (todas con `Authorization: Bearer <token>`):

- `POST /analisis` con `{"texto": "..."}`: el enlace o el mensaje completo que lo contiene.
  `202` con `{id, estado, url}`. `400` si no hay enlace http/https. `429` si el usuario ya tiene
  3 analisis en proceso o mando mas de 10 en un minuto.
- `GET /analisis/{id}`: `{id, url, estado, veredicto, razones, urlFinal, captura, desdeCache,
  detalles, creadoEn, actualizadoEn}`. `estado`: `pendiente`, `procesando`, `terminado` o `error`.
  `veredicto`: `seguro`, `sospechoso` o `peligroso`. `captura`: PNG en base64. `404` si no existe
  o es de otro usuario. La app consulta cada 2 segundos hasta que el estado sea `terminado` o `error`.
- `GET /historial?limite=20`: lista `{id, url, estado, veredicto, creadoEn}`, del mas reciente al
  mas antiguo (maximo 50, sin captura).

- `GET /salud`: `{"ok": true}` si la API y la base de datos responden.

Todos los errores responden `{"detail": "..."}`.

## Contrato del sandbox

`POST /abrir` con `{"url": "https://..."}`

- `200`: analisis terminado. Campos: `urlInicial`, `urlFinal`, `redirecciones`,
  `titulo`, `formulariosPassword`, `descargaIntentada`, `archivoDescarga`,
  `peticionesBloqueadas`, `tiempoExcedido`, `navegadorFallo`, `errores`,
  `capturaPngBase64`, `peligro`, `motivos`.
- `400`: enlace invalido o direccion interna.
- `503`: el sandbox esta ocupado o reiniciandose; intentar con otro.
- `504`: el analisis se congelo; el sandbox se reinicia.

Si `peligro` es `true` o el navegador se cayo, el sandbox se cierra despues de
responder y Docker lo vuelve a levantar limpio.

`GET /salud` responde `{"ok": true, "ocupado": false}`.
