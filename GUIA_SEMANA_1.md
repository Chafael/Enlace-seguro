# Guia de la semana 1: sandbox funcionando

Objetivo de la semana: que un comando de Docker reciba un enlace y regrese su captura.
El codigo del sandbox ya esta escrito en TypeScript y probado; esta guia es para que lo
corran en su computadora y entiendan cada parte para defenderlo.

## Paso 1. Subir el proyecto a GitHub

1. Descomprimir `enlaceseguro.zip`, por ejemplo en `C:\Dev\enlaceseguro`.
2. Abrir una terminal en esa carpeta:

```
git init
git add .
git commit -m "Estructura inicial y sandbox"
```

3. Crear un repositorio vacio en GitHub llamado `enlaceseguro`, subirlo con
   `git remote add origin ...` y `git push`, y agregar a Arturo en
   Settings > Collaborators.

## Paso 2. Darle memoria a Docker

Abrir `C:\Users\<tu usuario>\.wslconfig` y dejarlo asi:

```
[wsl2]
memory=8GB
swap=2GB
```

Ejecutar `wsl --shutdown` y volver a abrir Docker Desktop.

## Paso 3. Prueba minima sin Docker (15 minutos)

Necesitan Node 22 o superior.

```
cd sandbox
npm install
npx playwright install chromium
npm run prueba -- https://example.com
```

Debe aparecer el titulo de la pagina y un archivo `captura.png` con vista de celular.
Si esto funciona, el camino principal del proyecto esta confirmado.

Para correr el servidor del sandbox sin Docker: `npm run dev`. Queda en
`http://127.0.0.1:9000`.

## Paso 4. El sandbox dentro de Docker

1. En la carpeta raiz, copiar `.env.example` como `.env` y cambiar la contrasena.
2. Levantar solo un sandbox:

```
docker compose up --build sandbox1
```

La primera vez tarda porque descarga la imagen de Playwright (cerca de 2 GB).

3. En otra terminal, en la carpeta raiz, probar con el script (muestra el resultado
   y abre la captura):

```
powershell -ExecutionPolicy Bypass -File scripts\probar-sandbox.ps1 -Url https://example.com
```

4. Probar tambien con el enlace oficial de phishing de prueba de Google:
   `https://testsafebrowsing.appspot.com/s/phishing.html`

5. Probar los bloqueos; los dos deben responder error 400:
   `-Url http://localhost` y `-Url http://192.168.1.1`

Tambien se puede probar con Postman: `POST http://127.0.0.1:9001/abrir` con el cuerpo
`{"url": "https://example.com"}`.

## Paso 5. Probar los 3 sandboxes y el reinicio

```
docker compose up --build -d
docker compose ps
```

Deben aparecer `db`, `sandbox1`, `sandbox2` y `sandbox3` en estado running.

Para probar el cierre y el reinicio, mandar un enlace que descarga un archivo; el
sandbox lo detecta, responde con peligro y se cierra:

```
powershell -ExecutionPolicy Bypass -File scripts\probar-sandbox.ps1 -Url https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe
docker compose ps
docker compose logs sandbox1
```

En `ps`, `sandbox1` mostrara pocos segundos en "Up" (se acaba de reiniciar), y en los
logs aparecera dos veces "Sandbox escuchando en el puerto 9000". No sirve
`docker compose exec sandbox1 kill 1`: Docker no deja que una senal simple termine el
proceso principal de Node.

## Si algo falla

- **Chromium se cierra al abrir paginas:** revisar que `shm_size: 1gb` este en el
  `docker-compose.yml`.
- **Error "read-only file system":** es por `read_only: true`. Comentar esa linea un
  momento para confirmar; si asi funciona, agregar la carpeta que mencione el error a
  la lista de `tmpfs`.
- **No arranca por memoria:** levantar solo `sandbox1` y subir `memory` en `.wslconfig`.
- **La version de Playwright no coincide:** la de `package.json` (1.56.0) debe ser la
  misma que la etiqueta de la imagen en el `Dockerfile` (v1.56.0).

## Que ya se probo

Se probo el servidor del sandbox con paginas de prueba (sin Docker, porque aqui no
habia Docker disponible), y tambien la version compilada con `npm run build`:

- Pagina normal: captura, titulo y direccion final correctos.
- Pagina con formulario de contrasena: lo detecta.
- Redireccion de servidor y redireccion por JavaScript: registra los 3 saltos.
- Enlaces a localhost, 10.0.0.1, [::1], [::ffff:127.0.0.1], 169.254.169.254, file:// y
  textos que no son enlace: rechazados con 400.
- Cuerpo JSON incorrecto: rechazado con 400 por la validacion de Fastify.
- Pagina que intenta cargar recursos de 10.0.0.5 y localhost: los bloquea, marca
  peligro y el sandbox se cierra.
- Pagina que intenta abrir un WebSocket a localhost: lo bloquea, peligro y cierre.
- Descarga directa de un .apk y descarga disparada por JavaScript: detectadas,
  peligro y cierre.
- Pagina que tarda mas de 20 segundos: tiempo excedido, peligro y cierre.
- Segunda peticion mientras el sandbox trabaja: responde 503 ocupado.

Lo que falta confirmar en su PC es que todo funcione igual dentro de Docker con las
restricciones (pasos 4 y 5).

---

# Explicacion del codigo

El sandbox esta dividido en cuatro archivos, cada uno con una sola responsabilidad:

- `direcciones.ts`: decide si una direccion es interna.
- `analizar.ts`: abre la pagina y observa lo que hace.
- `servidor.ts`: los endpoints y el control de "un analisis a la vez".
- `index.ts`: solo enciende el servidor; no tiene logica.

## direcciones.ts

```ts
const NOMBRES_BLOQUEADOS = new Set(['localhost', 'api', 'db', 'sandbox1', 'sandbox2', 'sandbox3']);

export async function esDireccionInterna(host: string): Promise<boolean> {
  const nombre = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!nombre) return true;
  if (NOMBRES_BLOQUEADOS.has(nombre)) return true;

  let direcciones: { address: string }[];
  try {
    direcciones = await lookup(nombre, { all: true });
  } catch {
    return false;
  }

  return direcciones.some(({ address }) => {
    let ip = ipaddr.parse(address);
    if (ip instanceof ipaddr.IPv6 && ip.isIPv4MappedAddress()) {
      ip = ip.toIPv4Address();
    }
    return ip.range() !== 'unicast';
  });
}
```

→ **new Set([...])** (nuevo conjunto) — lista de nombres de los otros contenedores; la pagina nunca debe poder llamarlos.
→ **export async function** (exportar funcion asincrona) — otros archivos la pueden usar, y puede esperar al DNS sin bloquear.
→ **Promise<boolean>** (promesa de booleano) — al final regresa true o false.
→ **toLowerCase().replace(...)** (minusculas, reemplazar) — normaliza el nombre y quita los corchetes de las IPv6, como en [::1].
→ **NOMBRES_BLOQUEADOS.has(nombre)** (tiene) — bloquea "api", "db" y los sandboxes.
→ **lookup(nombre, { all: true })** (buscar, todas) — pregunta al DNS todas las IPs del dominio.
→ **catch { return false }** (atrapar) — si el dominio no existe no es un ataque; el navegador fallara solo.
→ **direcciones.some(...)** (alguna) — basta con que una IP sea interna para bloquear.
→ **ipaddr.parse** (analizar) — convierte el texto de la IP en un objeto que sabe de que tipo es.
→ **isIPv4MappedAddress / toIPv4Address** (es IPv4 dentro de IPv6, convertir) — ::ffff:127.0.0.1 es en realidad localhost; se convierte para no dejarlo pasar.
→ **range() !== 'unicast'** (rango distinto de publica) — unicast es una IP publica normal; privada, loopback, linkLocal (169.254.x de la nube) o reservada se bloquean.

*Este archivo impide que una pagina use el sandbox para atacar la red interna. Revisa la IP real y no solo el nombre, porque un dominio puede apuntar a 127.0.0.1 a proposito.*

## analizar.ts, bloque 1: validacion

```ts
let enlace: URL;
try {
  enlace = new URL(url);
} catch {
  throw new ErrorDeEnlace('El enlace no es valido');
}
if (!['http:', 'https:'].includes(enlace.protocol)) {
  throw new ErrorDeEnlace('Solo se aceptan enlaces http o https');
}
if (await esInterna(enlace.hostname)) {
  throw new ErrorDeEnlace('No se permiten direcciones internas');
}
```

→ **new URL(url)** — intenta interpretar el texto como enlace; si no se puede, falla.
→ **throw new ErrorDeEnlace** (lanzar error de enlace) — error propio que el servidor convierte en respuesta 400.
→ **enlace.protocol** (protocolo) — el inicio del enlace: http:, https:, file:, etc.
→ **includes** (incluye) — solo se aceptan http y https; file:// podria leer archivos del contenedor.
→ **esInterna(enlace.hostname)** — revisa el dominio con el archivo anterior antes de abrir nada.

*Este bloque rechaza enlaces peligrosos antes de abrir el navegador.*

## analizar.ts, bloque 2: sesion desechable

```ts
const contexto = await navegador.newContext({
  ...CELULAR,
  acceptDownloads: false,
  serviceWorkers: 'block',
});
```

→ **newContext** (nuevo contexto) — una sesion en blanco: sin cookies, sin historial, sin datos de otros analisis. Por eso los resultados nunca se mezclan.
→ **...CELULAR** (expandir celular) — aplica el tamano de pantalla y navegador de un Pixel 7.
→ **acceptDownloads: false** (aceptar descargas: no) — ningun archivo llega a guardarse.
→ **serviceWorkers: 'block'** (bloquear trabajadores de servicio) — la pagina no puede dejar codigo corriendo en segundo plano.

*Este bloque crea la sesion aislada donde se abre el enlace.*

## analizar.ts, bloque 3: vigilantes

```ts
await contexto.route('**/*', async (ruta) => {
  const destino = new URL(ruta.request().url());
  if (['http:', 'https:'].includes(destino.protocol) && (await esInterna(destino.hostname))) {
    hallazgos.peticionesBloqueadas.push(destino.href.slice(0, 200));
    return ruta.abort('blockedbyclient');
  }
  return ruta.continue();
});

await contexto.routeWebSocket(/.*/, async (socket) => {
  if (await esInterna(new URL(socket.url()).hostname)) {
    hallazgos.peticionesBloqueadas.push(socket.url().slice(0, 200));
    return socket.close();
  }
  socket.connectToServer();
});

pagina.on('download', (descarga) => {
  hallazgos.descargaIntentada = true;
  hallazgos.archivoDescarga = descarga.suggestedFilename();
});

pagina.on('request', (peticion) => {
  if (peticion.isNavigationRequest() && peticion.frame() === pagina.mainFrame()) {
    if (hallazgos.redirecciones.at(-1) !== peticion.url()) hallazgos.redirecciones.push(peticion.url());
  }
});
```

→ **route('\*\*/\*', ...)** (ruta, todo) — intercepta cada cosa que pide la pagina: imagenes, scripts, llamadas.
→ **abort('blockedbyclient')** (abortar, bloqueado por el cliente) — cancela la peticion interna como si no existiera.
→ **push** (agregar) — anota la direccion bloqueada como evidencia.
→ **continue()** (continuar) — deja pasar lo normal hacia internet.
→ **routeWebSocket** (ruta de WebSocket) — lo mismo para conexiones WebSocket, que no pasan por route.
→ **socket.close() / connectToServer()** (cerrar, conectar al servidor) — corta la interna o deja pasar la externa.
→ **on('download')** (al descargar) — anota el intento y el nombre del archivo, por ejemplo BBVA_seguro.apk.
→ **on('request')** + **isNavigationRequest()** (al pedir, es navegacion) — registra cada salto de la pagina principal: redirecciones del servidor y por JavaScript.
→ **at(-1)** (en la ultima posicion) — evita anotar dos veces la misma direccion seguida.

*Este bloque vigila todo lo que la pagina intenta hacer: bloquea lo interno, anota descargas y registra redirecciones.*

## analizar.ts, bloque 4: abrir y capturar

```ts
try {
  await pagina.goto(url, { waitUntil: 'load', timeout: TIEMPO_LIMITE_MS });
  await pagina.waitForTimeout(ESPERA_SCRIPTS_MS);
} catch (error) {
  if (error instanceof errors.TimeoutError) {
    hallazgos.tiempoExcedido = true;
  } else if (primeraLinea(error).includes('Download is starting')) {
    hallazgos.descargaIntentada = true;
  } else {
    hallazgos.errores.push(`No se pudo abrir la pagina: ${primeraLinea(error)}`);
  }
}

hallazgos.urlFinal = pagina.url();
hallazgos.titulo = await pagina.title();
hallazgos.formulariosPassword = await pagina.locator('input[type=password]').count();
const captura = await pagina.screenshot({ timeout: 5_000 });
hallazgos.capturaPngBase64 = captura.toString('base64');
...
} finally {
  await contexto.close();
}
```

→ **goto** (ir a) — abre el enlace con limite de 20 segundos.
→ **waitUntil: 'load'** (esperar hasta cargar) — espera a que la pagina termine de cargar.
→ **waitForTimeout** (esperar tiempo) — 1.5 segundos extra para que corran los scripts.
→ **instanceof errors.TimeoutError** (es error de tiempo) — si tardo demasiado, se anota como señal de peligro.
→ **'Download is starting'** (la descarga esta iniciando) — Playwright avisa asi cuando el enlace es directamente un archivo.
→ **pagina.url()** — la direccion donde termino despues de las redirecciones.
→ **locator('input[type=password]').count()** (localizar, contar) — cuenta los campos de contrasena.
→ **screenshot** (captura de pantalla) — la imagen de lo que ve el celular simulado.
→ **toString('base64')** — convierte la imagen en texto para mandarla en JSON.
→ **finally** (finalmente) — siempre se ejecuta: cierra y borra la sesion aunque haya errores.

*Este bloque abre la pagina, anota como termino y toma la captura, y siempre destruye la sesion.*

## analizar.ts, bloque 5: decidir peligro

```ts
export function decidirPeligro(hallazgos: Hallazgos): void {
  const motivos: string[] = [];
  if (hallazgos.descargaIntentada) motivos.push('La pagina intento descargar un archivo');
  if (hallazgos.peticionesBloqueadas.length > 0) motivos.push('La pagina intento conectarse a direcciones internas');
  if (hallazgos.tiempoExcedido) motivos.push('La pagina excedio el tiempo limite');
  hallazgos.peligro = motivos.length > 0;
  hallazgos.motivos = motivos;
}
```

→ **motivos: string[]** (lista de textos) — razones en lenguaje sencillo para mostrarlas en la app.
→ **length > 0** (longitud mayor a cero) — si hay al menos un motivo, hay peligro.

*Este bloque decide si el sandbox debe cerrarse. El formulario de contrasena no lo cierra, porque los bancos reales tambien tienen uno; esa decision la toma la API en la semana 3, comparando el dominio con la marca que dice ser.*

## servidor.ts, bloque 1: opciones y validacion del cuerpo

```ts
export interface OpcionesServidor {
  esInterna?: RevisorDeDirecciones;
  alCerrar?: () => void;
}

const esquemaAbrir = {
  body: {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
  },
} as const;
```

→ **interface** (interfaz) — define que opciones acepta el servidor; las dos son opcionales (?).
→ **esInterna? / alCerrar?** — permiten reemplazar el revisor y el cierre solo en pruebas; en Docker se usan los reales.
→ **esquemaAbrir** (esquema) — Fastify valida el JSON antes de entrar al endpoint.
→ **required: ['url']** (requerido) — sin url responde 400.
→ **additionalProperties: false** (propiedades extra: no) — rechaza campos que no esperamos.
→ **maxLength: 2048** (longitud maxima) — evita enlaces gigantes que saturen el sandbox.

*Este bloque define las opciones del servidor y valida lo que llega, igual que en FlowPass se valida en el backend.*

## servidor.ts, bloque 2: navegador y cierre

```ts
app.addHook('onReady', async () => {
  navegador = await chromium.launch();
});
app.addHook('onClose', async () => {
  await navegador?.close();
});

const cerrarAlResponder = (respuesta: FastifyReply) => {
  respuesta.raw.once('finish', alCerrar);
};
```

→ **addHook('onReady')** (agregar gancho, al estar listo) — abre Chromium una sola vez al encender el sandbox.
→ **addHook('onClose')** (al cerrar) — cierra el navegador al apagar.
→ **navegador?.close()** — el ? evita error si el navegador no se alcanzo a abrir.
→ **respuesta.raw.once('finish', alCerrar)** (una vez, al terminar) — espera a que la respuesta salga completa y entonces termina el proceso; Docker lo levanta limpio por `restart: always`.

*Este bloque maneja el navegador compartido y el cierre del sandbox despues de responder.*

## servidor.ts, bloque 3: endpoints

```ts
app.get('/salud', async () => ({ ok: true, ocupado }));

app.post<{ Body: { url: string } }>('/abrir', { schema: esquemaAbrir }, async (peticion, respuesta) => {
  if (ocupado) return respuesta.code(503).send({ detail: 'Sandbox ocupado' });
  ocupado = true;
  let liberar = true;
  ...
  const resultado = await Promise.race([analizar(...), limite]);
  if (resultado === 'congelado') {
    liberar = false;
    cerrarAlResponder(respuesta);
    return respuesta.code(504).send({ detail: '...' });
  }
  decidirPeligro(resultado);
  if (resultado.peligro) {
    liberar = false;
    cerrarAlResponder(respuesta);
  }
  return resultado;
  ...
  } catch (error) {
    if (error instanceof ErrorDeEnlace) return respuesta.code(400).send({ detail: error.message });
    throw error;
  } finally {
    clearTimeout(temporizador);
    if (liberar) ocupado = false;
  }
});
```

→ **app.get('/salud')** (obtener) — la API lo usa para saber si el sandbox esta vivo y libre.
→ **app.post<{ Body: ... }>** (enviar) — el endpoint del analisis; el tipo le dice a TypeScript que trae `url`.
→ **if (ocupado) ... code(503)** — si ya hay un analisis, responde ocupado y la API prueba con otro sandbox.
→ **ocupado = true** — marca el sandbox como ocupado. Node ejecuta un solo hilo, asi que no pueden entrar dos peticiones al mismo tiempo en esta linea.
→ **liberar** — si el sandbox se va a cerrar, se queda ocupado para que nadie mas entre en ese medio segundo.
→ **Promise.race** (carrera de promesas) — gana lo que termine primero: el analisis o el limite de 30 segundos.
→ **'congelado'** — si gano el limite, el navegador se trabo: responde 504 y se cierra.
→ **code(400)** — los errores de enlace del bloque de validacion.
→ **throw error** (volver a lanzar) — cualquier otro error lo maneja Fastify con un 500.
→ **clearTimeout** (cancelar temporizador) — apaga el limite de 30 segundos cuando ya no hace falta.

*Este bloque expone el sandbox a la API con un analisis a la vez, limite total de tiempo y cierre automatico si hay peligro.*

## Preguntas que les pueden hacer

- **¿Por qué un solo navegador y no uno por análisis?** Abrir Chromium tarda varios
  segundos. Cada analisis usa un contexto nuevo, que aísla cookies y datos igual que
  un navegador nuevo, y si hay peligro el contenedor completo se reinicia.
- **¿Qué pasa si la página tiene un exploit del navegador?** Queda encerrado en un
  contenedor sin privilegios, de solo lectura, sin acceso a la base de datos, con
  memoria y CPU limitadas, y que se destruye al detectar algo.
- **¿Por qué revisar la IP y no solo el nombre?** Porque un atacante puede registrar un
  dominio que apunte a 127.0.0.1 o a una IP interna.
- **¿Por qué dividir en archivos?** Cada archivo tiene una responsabilidad, `index.ts`
  no tiene logica, y asi `crearServidor` se puede probar reemplazando solo el revisor
  de direcciones.
