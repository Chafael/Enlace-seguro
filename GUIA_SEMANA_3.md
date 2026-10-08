# Guia de la semana 3: integracion del analisis

Objetivo de la semana: mandar un enlace (o un mensaje completo) a la API y recibir el
veredicto con la captura, usando la fila de analisis y los 3 sandboxes.

El codigo ya esta escrito y probado con PostgreSQL y 3 sandboxes reales. Las fuentes de
amenazas (VirusTotal, Google y URLhaus) son la parte de Arturo: por ahora hay una
version provisional que no consulta nada, y el veredicto sale solo del sandbox.

## Paso 1. Crear tu rama

Tu pull request de la semana 2 debe estar unido a `main`. Luego:

```
git checkout main
git pull
git checkout -b feature/analisis
```

## Paso 2. Copiar los archivos nuevos

Descomprime el zip (por ejemplo en `Seguridad Informática\enlaceseguro_s3`) y copia:

```
$nuevo = "C:\Users\rafar\OneDrive\Documentos\Seguridad Informática\enlaceseguro_s3\enlaceseguro"
Copy-Item "$nuevo\api\src\*" "C:\Dev\enlaceseguro\api\src\" -Recurse -Force
Copy-Item "$nuevo\sandbox\src\*" "C:\Dev\enlaceseguro\sandbox\src\" -Recurse -Force
Copy-Item "$nuevo\scripts\*" "C:\Dev\enlaceseguro\scripts\" -Force
Copy-Item "$nuevo\README.md", "$nuevo\GUIA_SEMANA_3.md" "C:\Dev\enlaceseguro\" -Force
git status
```

En `git status` deben aparecer la carpeta nueva `api/src/analisis/`, `api/src/rutas/analisis.ts`
y cambios en otros archivos de `api/src` y `sandbox/src`. Tu `.env` no se toca.

## Paso 3. Reconstruir y levantar

```
docker compose up --build -d
docker compose ps
docker compose logs api
```

Los 5 contenedores deben estar en Up. En los registros de la API debe aparecer
`Procesador iniciado con 3 sandboxes`. La base de datos se actualiza sola: la API agrega la
columna de la captura al arrancar, sin borrar tus usuarios.

## Paso 4. Probar

Cada prueba inicia sesion con una cuenta de demostracion, manda el texto, espera el
veredicto, abre la captura y muestra el historial:

```
powershell -ExecutionPolicy Bypass -File scripts\probar-analisis.ps1 -Texto "https://example.com"
```

Prueba tambien estos casos:

- Un mensaje completo con el enlace sin `https://`:
  `-Texto "DHL: tu paquete esta retenido, paga en example.com/pago ya"`
- Una descarga (debe salir PELIGROSO y reiniciarse un sandbox):
  `-Texto "https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe"`
- Una direccion interna (debe salir SOSPECHOSO: el sandbox se niega a abrirla):
  `-Texto "http://192.168.1.1/admin"`
- El mismo `example.com` otra vez: debe responder al instante con la nota de que se
  reutilizo un analisis reciente (cache).
- El sitio de prueba de phishing de Google:
  `-Texto "https://testsafebrowsing.appspot.com/s/phishing.html"`.
  Por ahora puede salir SEGURO, porque todavia no se consulta Google Safe Browsing. Cuando
  Arturo integre sus fuentes, debe salir PELIGROSO. Esa diferencia es buena para la demo.

Tambien puedes probar todo desde `http://127.0.0.1:8000/docs`: inicia sesion en
`/auth/login`, copia el token, pulsa **Authorize** arriba a la derecha y pegalo.

## Paso 5. Subirlo

```
git add .
git commit -m "Integracion: fila de analisis, reparto a los 3 sandboxes y veredicto"
git push -u origin feature/analisis
```

Abre el pull request a `main` y pide a Arturo que lo revise. Dile que lea la seccion
"Para Arturo" de esta guia antes de seguir con sus fuentes.

## Que ya se probo

Con PostgreSQL 16, la API y 3 sandboxes reales que se reinician solos como en Docker:

- Enlace normal: seguro, con captura y direccion final. Login falso: sospechoso.
  Descarga: peligroso, y ese sandbox se reinicio.
- Mensaje completo con el enlace sin `https://`, enlaces acortados y `www.`: se extrae
  bien el enlace. Correos, numeros de telefono, `ftp://`, `javascript:` y enlaces con
  `usuario:clave@`: rechazados.
- Cache: el mismo enlace dentro de 30 minutos se resuelve al instante.
- Un usuario no puede ver los analisis de otro (404).
- Limites: el cuarto analisis en proceso de un usuario recibe 429; el limite de 10 por
  minuto es por usuario (otro usuario desde la misma IP no se bloquea).
- Con los 3 sandboxes ocupados, un analisis nuevo espera en la fila y se procesa en
  cuanto uno se libera.
- Chromium cae a la mitad: la pagina sale peligrosa y los sandboxes se reinician.
- El proceso del sandbox muere a la mitad: la pagina sale peligrosa, los sandboxes vuelven
  y el siguiente analisis funciona normal.
- `docker stop` (SIGTERM) apaga los sandboxes de verdad.
- Un corte de conexion casual se reintenta en otro sandbox; dos cortes seguidos marcan la
  pagina como peligrosa. Si ningun sandbox responde en 60 segundos, el analisis queda en
  `error`.
- Si la API se apaga con un analisis a medias, al volver a encender lo regresa a la fila
  y lo termina.

## Correcciones al sandbox que salieron de las pruebas

1. **Playwright no cerraba el proceso.** Al recibir la senal de apagado, Playwright cerraba
   el navegador pero dejaba vivo el proceso, y el sandbox respondia "error 500" a todo
   sin que Docker lo reiniciara. Ahora el sandbox maneja la senal y, si el navegador se cae
   por cualquier motivo, se cierra para que Docker lo reemplace.
2. **Conexiones reutilizadas.** `fetch` reutiliza conexiones; cuando un sandbox se cerraba
   tras un peligro, el siguiente enlace viajaba por la conexion muerta y parecia que esa
   pagina lo habia tumbado. Ahora cada analisis usa una conexion nueva, y el sandbox deja
   de aceptar conexiones antes de cerrarse.

Las dos son buenas historias para la presentacion: las encontraron las pruebas de fallas.

## Correcciones de la auditoria con Claude Code

Una revision independiente del proyecto encontro tres cosas, ya corregidas:

1. **Alta: los sandboxes podian conectarse a la API.** La API comparte red con los sandboxes
   (la necesita para mandarles enlaces) y Docker no tiene redes de un solo sentido. El filtro
   de direcciones internas vive dentro del navegador; si una pagina tomara el control del
   contenedor, podria abrir una conexion directa a `api:8000`. Ademas, los 3 sandboxes
   compartian red y se veian entre si. Ahora:
   - Cada sandbox tiene su propia red (`red_sandbox1`, `red_sandbox2`, `red_sandbox3`): no ve a
     los otros dos.
   - La API rechaza con 403 cualquier peticion que llegue desde la IP de un sandbox
     (`api/src/bloqueoSandboxes.ts`). Los sandboxes no pueden falsificar su IP porque corren sin
     permisos de red especiales (`cap_drop: [ALL]`).
2. **Media:** la guia de la semana 2 decia "100 peticiones por minuto"; el codigo usa 300
   desde la semana 3. Ya esta corregida.
3. **Baja:** `probar-api.ps1` y `probar-sandbox.ps1` no mandaban el texto en UTF-8; con acentos
   o enies llegaria mal. Ya lo hacen, igual que `probar-analisis.ps1`.

### Verificar el aislamiento en Docker

Como cambiaron las redes, apaga todo y vuelve a levantar (tus usuarios no se borran):

```
docker compose down
docker compose up --build -d
```

Desde dentro del sandbox 1, intenta llegar a la API, al sandbox 2 y a la base de datos:

```
docker compose exec sandbox1 node -e "fetch('http://api:8000/salud').then(r => console.log('api:', r.status)).catch(e => console.log('api: sin conexion', e.cause?.code))"
docker compose exec sandbox1 node -e "fetch('http://sandbox2:9000/salud').then(r => console.log('sandbox2:', r.status)).catch(e => console.log('sandbox2: sin conexion', e.cause?.code))"
docker compose exec sandbox1 node -e "fetch('http://db:5432').then(r => console.log('db:', r.status)).catch(e => console.log('db: sin conexion', e.cause?.code))"
```

Lo esperado:

- `api: 403` (la API lo rechaza)
- `sandbox2: sin conexion ENOTFOUND` (no existe en su red)
- `db: sin conexion ENOTFOUND` (no existe en su red)

Y en los registros de la API (`docker compose logs api --tail 5`) aparece
`Peticion desde un sandbox bloqueada`. Toma captura de las tres respuestas: son evidencia
para las pruebas de seguridad de la semana 5. Despues confirma que todo sigue funcionando:

```
powershell -ExecutionPolicy Bypass -File scripts\probar-analisis.ps1 -Texto "https://example.com/otra"
```

### bloqueoSandboxes.ts

```ts
const nombres = [...new Set(direcciones.map((direccion) => new URL(direccion).hostname))];

async function ipsDeSandboxes() {
  if (Date.now() < memoria.hasta) return memoria.ips;
  ...
  for (const { address } of await resolver(nombre, { all: true })) {
    const ip = normalizar(address);
    if (!LOCALES.has(ip)) ips.add(ip);
  }
  ...
  memoria = { ips, hasta: Date.now() + VIGENCIA_MS };
}

app.addHook('onRequest', async (peticion, respuesta) => {
  const origen = normalizar(peticion.socket.remoteAddress ?? '');
  if ((await ipsDeSandboxes()).has(origen)) {
    peticion.log.warn({ origen }, 'Peticion desde un sandbox bloqueada');
    return respuesta.code(403).send({ detail: 'Acceso denegado' });
  }
});
```

→ **nombres** — de `http://sandbox1:9000` saca `sandbox1`, el nombre del contenedor.
→ **resolver(nombre)** — pregunta al DNS de Docker que IP tiene ese sandbox ahora mismo.
→ **memoria de 5 segundos** — un sandbox reiniciado puede cambiar de IP; se vuelve a preguntar seguido, pero no en cada peticion.
→ **LOCALES** — sin Docker (en desarrollo), un sandbox puede ser 127.0.0.1; no se bloquea a uno mismo.
→ **remoteAddress** (direccion remota) — la IP desde donde llego la conexion.
→ **normalizar** — quita el prefijo `::ffff:` con que Node a veces escribe las IPv4.
→ **onRequest** — se registra primero que todo: la peticion se rechaza antes de llegar a cualquier ruta.
→ **code(403)** — "prohibido", y queda anotado en los registros como evidencia.

*Este archivo es una segunda barrera: aunque un sandbox fuera tomado, no puede usar la API.*

**Para la defensa:** el aislamiento total entre redes requeriria un firewall o un
intermediario, porque Docker no tiene redes de un solo sentido. Con redes separadas por
sandbox, la base de datos en una red sin internet, contenedores sin permisos de red y el
bloqueo por IP en la API, un sandbox comprometido no puede llegar a nada util.

---

# Como fluye un analisis

1. La app manda `POST /analisis` con el texto. La API extrae el enlace, revisa limites y
   cache, guarda una fila en estado `pendiente` y responde de inmediato con su `id`.
2. Uno de los 3 trabajadores del procesador toma la fila y la marca `procesando`.
3. El trabajador busca un sandbox libre y le manda el enlace.
4. Con lo que vio el sandbox (enlace inicial, redirecciones y enlace final), se consultan
   las fuentes de amenazas (Arturo).
5. Se calcula el veredicto (Arturo) y se guarda con la captura: estado `terminado`.
6. Mientras tanto, la app pregunta `GET /analisis/{id}` cada 2 segundos hasta ver
   `terminado`.

Se responde de inmediato y se procesa despues porque un analisis tarda varios segundos: si
la peticion se quedara esperando, con muchos usuarios la API se saturaria.

---

# Explicacion del codigo

## analisis/enlace.ts

```ts
const CON_ESQUEMA = /\bhttps?:\/\/[^\s<>"'`]+/i;
const SIN_ESQUEMA = /(?<![@\w./:-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{2,5})?(?:\/[^\s<>"'`]*)?/i;

export function extraerEnlace(texto: string): string | null {
  const encontrado = texto.match(CON_ESQUEMA)?.[0] ?? texto.match(SIN_ESQUEMA)?.[0];
  if (!encontrado) return null;
  let candidato = encontrado.replace(PUNTUACION_FINAL, '');
  if (!/^https?:\/\//i.test(candidato)) candidato = `https://${candidato}`;
  const enlace = new URL(candidato);
  if (enlace.username || enlace.password) return null;
  enlace.hash = '';
  ...
}
```

→ **CON_ESQUEMA** — busca un enlace que empieza con http:// o https://.
→ **SIN_ESQUEMA** — busca dominios sin esquema como `bit.ly/abc` o `www.sat-devolucion.com`; los mensajes de estafa casi nunca escriben el https://.
→ **(?<![@\w./:-])** (lo que NO puede ir antes) — evita tomar el dominio de un correo (`soporte@gmail.com`) o de otro esquema (`ftp://`).
→ **?? ** — si no hay enlace con esquema, prueba sin esquema.
→ **PUNTUACION_FINAL** — quita el punto o parentesis con que termina una oracion ("paga en bit.ly/abc.").
→ **https://${candidato}** — a lo que no traia esquema se le pone https.
→ **enlace.username / password** — rechaza `https://banco.com@evil.xyz`, un truco de phishing donde lo que parece el banco es en realidad un "usuario" y el sitio real es otro.
→ **enlace.hash = ''** — lo que va despues de `#` no cambia la pagina; quitarlo ayuda a que la cache reconozca el mismo enlace.

*Este archivo saca un solo enlace limpio del mensaje; el texto del mensaje nunca se guarda (privacidad).*

## rutas/analisis.ts, bloque 1: crear un analisis

```ts
app.addHook('onRequest', autenticar);

app.post('/analisis', {
  schema: esquemaCrear,
  config: { rateLimit: { max: 10, timeWindow: '1 minute', hook: 'preHandler',
                         keyGenerator: (peticion) => `usuario:${peticion.user.sub}` } },
}, async (peticion, respuesta) => {
  const url = extraerEnlace(peticion.body.texto);
  if (!url) return respuesta.code(400).send({ detail: 'No se encontro un enlace http o https en el texto' });

  const enProceso = await db.query("SELECT count(*)::int AS total FROM analisis WHERE usuario_id = $1 AND estado IN ('pendiente', 'procesando')", [usuarioId]);
  if (enProceso.rows[0].total >= MAX_EN_PROCESO) return respuesta.code(429).send(...);

  const reciente = await db.query(`SELECT veredicto, resultado, captura FROM analisis
     WHERE url = $1 AND estado = 'terminado' AND actualizado_en > now() - make_interval(mins => $2) ...`, [url, MINUTOS_CACHE]);
  if (reciente.rows[0]) { ...INSERT ... estado 'terminado' ...; return respuesta.code(202).send(rows[0]); }

  const { rows } = await db.query('INSERT INTO analisis (usuario_id, url) VALUES ($1, $2) RETURNING id, estado, url', [usuarioId, url]);
  avisar();
  return respuesta.code(202).send(rows[0]);
});
```

→ **addHook('onRequest', autenticar)** (gancho al recibir) — protege todas las rutas del archivo de una vez; sin token, 401.
→ **hook: 'preHandler'** (antes del manejador) — el limite se aplica despues de autenticar, cuando ya se sabe quien es.
→ **keyGenerator** (generador de clave) — cuenta los 10 por minuto por usuario y no por IP: en el Wi-Fi de la escuela todos comparten IP y se bloquearian entre si.
→ **MAX_EN_PROCESO = 3** — nadie puede tener mas de 3 analisis esperando; asi un solo usuario no acapara los 3 sandboxes.
→ **cache de 30 minutos** — si alguien ya reviso ese enlace, se copia el resultado: responde al instante y ahorra sandbox y consultas a las fuentes.
→ **code(202)** (aceptado) — significa "lo recibi y lo voy a procesar", a diferencia de 200 "aqui esta el resultado".
→ **avisar()** — despierta al procesador para que no espere a su siguiente revision.

*Este bloque recibe el enlace, aplica los limites y lo forma en la fila.*

## rutas/analisis.ts, bloque 2: consultar y historial

```ts
app.get('/analisis/:id', { schema: esquemaConsultar }, async (peticion, respuesta) => {
  const { rows } = await db.query(`SELECT ... FROM analisis WHERE id = $1 AND usuario_id = $2`,
    [peticion.params.id, peticion.user.sub]);
  if (!fila) return respuesta.code(404).send({ detail: 'Analisis no encontrado' });
  ...
});

app.get('/historial', { schema: esquemaHistorial }, async (peticion) => {
  ... SELECT id, url, estado, veredicto, creado_en ... WHERE usuario_id = $1 ORDER BY creado_en DESC LIMIT $2
});
```

→ **format: 'uuid'** (en el esquema) — un id que no es UUID se rechaza con 400 antes de llegar a la base de datos.
→ **AND usuario_id = $2** — solo encuentra analisis propios.
→ **code(404)** — tambien para analisis ajenos: si respondiera 403, revelaria que ese id existe.
→ **historial sin captura** — la lista es ligera; la captura solo viaja al abrir un analisis.
→ **maximum: 50** — nadie puede pedir el historial completo de golpe.

*Este bloque deja consultar el resultado y el historial, solo de los analisis propios.*

## analisis/procesador.ts, bloque 1: recuperacion y tomar de la fila

```ts
await db.query("UPDATE analisis SET estado = 'pendiente', actualizado_en = now() WHERE estado = 'procesando'");

async function tomarSiguiente() {
  const { rows } = await db.query(`
    UPDATE analisis SET estado = 'procesando', actualizado_en = now()
    WHERE id = (
      SELECT id FROM analisis WHERE estado = 'pendiente'
      ORDER BY creado_en LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, url`);
  return rows[0];
}
```

→ **UPDATE ... WHERE estado = 'procesando'** (al arrancar) — si la API se apago a la mitad, esos analisis regresan a la fila en vez de quedarse atorados para siempre.
→ **ORDER BY creado_en LIMIT 1** — el mas antiguo primero (fila justa).
→ **FOR UPDATE** (bloquear para actualizar) — aparta esa fila mientras se cambia su estado.
→ **SKIP LOCKED** (saltar las bloqueadas) — si otro trabajador ya aparto esa fila, toma la siguiente. Asi los 3 trabajadores nunca toman el mismo analisis: es justo lo que pidio el maestro de "no mezclar".
→ **RETURNING** — devuelve la fila tomada en la misma operacion.

*Este bloque usa la base de datos como fila de espera segura para varios trabajadores, sin necesidad de Redis.*

## analisis/procesador.ts, bloque 2: procesar uno

```ts
const sandbox = await sandboxes.analizar(url);
if (sandbox.estado === 'no-disponible') { ...estado = 'error'...; return; }

const vistos = [url, ...(sandbox.hallazgos?.redirecciones ?? []), sandbox.hallazgos?.urlFinal];
const urls = [...new Set(vistos.filter((u) => !!u && /^https?:\/\//i.test(u)))];

let fuentes = { consultas: [], edadDominioDias: null };
try {
  fuentes = await revisarFuentes(urls);
} catch (error) { log.error(...); }

const decision = calcularVeredicto(fuentes, sandbox);
await db.query(`UPDATE analisis SET estado = 'terminado', veredicto = $2, resultado = $3, captura = $4 ...`, [...]);
```

→ **sandboxes.analizar** — manda el enlace a un sandbox libre (archivo siguiente).
→ **vistos** — el enlace inicial, cada salto y el final: un acortador puede llevar a un sitio malicioso que las fuentes si conocen.
→ **new Set** (conjunto) — quita repetidos para no gastar consultas.
→ **try / catch en fuentes** — si una fuente externa falla, el analisis sigue con lo que vio el sandbox; nunca se queda atorado.
→ **calcularVeredicto** — la decision final (Arturo).
→ **resultado (JSONB) y captura (TEXT) por separado** — el historial no carga imagenes.

*Este bloque junta sandbox, fuentes y veredicto, y guarda el resultado.*

## analisis/procesador.ts, bloque 3: trabajadores y aviso

```ts
const esperar = (ms) => new Promise((resolver) => {
  const temporizador = setTimeout(resolver, ms);
  despertadores.push(() => { clearTimeout(temporizador); resolver(); });
});

async function trabajar(numero: number) {
  while (activo) {
    const fila = await tomarSiguiente();
    if (!fila) { await esperar(ESPERA_SIN_TRABAJO_MS); continue; }
    try { await procesar(fila.id, fila.url); }
    catch (error) { ...estado = 'error'... }
  }
}

const bucles = Array.from({ length: trabajadores }, (_, i) => trabajar(i + 1));
```

→ **esperar** — duerme 2 segundos si no hay trabajo, pero `avisar()` lo despierta antes; asi un analisis nuevo empieza al instante sin consultar la base de datos sin parar.
→ **while (activo)** (mientras este activo) — cada trabajador repite tomar, procesar, tomar...
→ **catch → 'error'** — si algo inesperado falla, el analisis queda en error y el trabajador sigue con el siguiente.
→ **trabajadores = 3** — uno por sandbox: nunca hay mas analisis en curso que sandboxes.

*Este bloque mantiene 3 trabajadores procesando la fila en paralelo.*

## analisis/sandboxes.ts, bloque 1: elegir sandbox

```ts
while (Date.now() < limite) {
  const inicio = this.siguiente;
  for (let intento = 0; intento < this.direcciones.length; intento++) {
    const indice = (inicio + intento) % this.direcciones.length;
    if (cortaron.has(indice)) continue;
    const resultado = await this.intentar(this.direcciones.at(indice)!, url);
    if (resultado === 'no-libre') continue;
    this.siguiente = (indice + 1) % this.direcciones.length;
    if (resultado === 'conexion-cortada') {
      cortaron.add(indice);
      if (cortaron.size >= 2 || cortaron.size === this.direcciones.length) {
        return { estado: 'fallo', ..., detalle: 'La pagina hizo fallar el sandbox' };
      }
      continue;
    }
    return resultado;
  }
  await dormir(1_000);
}
return { estado: 'no-disponible', ... };
```

→ **this.siguiente** (siguiente en turno) — reparte los analisis entre los 3 por turnos (round robin).
→ **% this.direcciones.length** (modulo) — despues del 3 vuelve al 1.
→ **'no-libre'** — ocupado (503), reiniciandose (conexion rechazada) o descompuesto (500): prueba con el siguiente.
→ **cortaron** — sandboxes que cortaron la conexion con este enlace; no se les vuelve a mandar.
→ **cortaron.size >= 2** — un corte puede ser casualidad; dos con el mismo enlace significa que la pagina tumba sandboxes: peligrosa. Se limita a dos para que una pagina maliciosa no tumbe los tres.
→ **dormir(1_000)** — si todos estan ocupados, espera un segundo y vuelve a probar.
→ **'no-disponible'** — despues de 60 segundos sin sandbox libre, el analisis queda en error.

*Este bloque reparte los enlaces entre los sandboxes y decide que hacer si uno no responde.*

## analisis/sandboxes.ts, bloque 2: enviar

```ts
const peticion = http.request(new URL('/abrir', base), {
  method: 'POST',
  agent: false,
  headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(cuerpo) },
}, (respuesta) => { ...junta los datos y resuelve... });
const temporizador = setTimeout(() => {
  peticion.destroy(Object.assign(new Error('Tiempo agotado'), { code: 'TIEMPO_AGOTADO' }));
}, tiempoMs);
```

→ **http.request** — peticion HTTP de Node, sin librerias extra.
→ **agent: false** (sin agente) — conexion nueva que se cierra al terminar. Nunca se reutiliza una conexion a un sandbox que ya se cerro (fue la correccion 2).
→ **content-length** (longitud del contenido) — le dice al sandbox cuantos bytes llegan.
→ **setTimeout(... destroy)** — si el sandbox no responde en 45 segundos, se corta y la pagina se toma como que lo congelo.

*Este bloque envia el enlace a un sandbox con una conexion limpia y con tiempo limite.*

## analisis/contrato.ts y veredicto.ts (provisional)

```ts
export interface ResultadoSandbox {
  estado: 'ok' | 'fallo' | 'rechazado' | 'no-disponible';
  hallazgos: HallazgosSandbox | null;
  captura: string | null;
  detalle?: string;
}
export interface ResultadoFuentes { consultas: ConsultaFuente[]; edadDominioDias: number | null; }
export interface Decision { veredicto: 'seguro' | 'sospechoso' | 'peligroso'; razones: string[]; }
```

→ **contrato** — los tipos que comparten tu codigo y el de Arturo. Mientras nadie los cambie, cada quien trabaja sin romper al otro.
→ **'fallo'** — el sandbox se cayo con esa pagina: peligroso por si mismo.
→ **'rechazado'** — el sandbox se nego a abrirlo (direccion interna): sospechoso.
→ **razones** — frases en lenguaje sencillo que la app muestra tal cual.

El veredicto provisional ya sigue la regla de la propuesta: peligroso si una fuente lo
reporta o el sandbox detecto peligro; sospechoso si pide contrasena, si el dominio tiene
menos de 30 dias o si no se pudo abrir; seguro en otro caso.

*Estos archivos fijan el acuerdo con Arturo y dan un veredicto funcional mientras el termina.*

## Cambios en el sandbox (servidor.ts)

```ts
const apagar = () => {
  if (cerrando) return;
  cerrando = true;
  app.server.close();
  app.server.closeAllConnections();
  alCerrar();
};

navegador = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
navegador.on('disconnected', () => {
  navegadorCaido = true;
  if (!ocupado) apagar();
});
```

→ **app.server.close()** (cerrar servidor) — deja de aceptar conexiones antes de cerrarse; nadie le manda un enlace a un sandbox que esta muriendo.
→ **closeAllConnections()** (cerrar todas las conexiones) — corta tambien las que quedaron abiertas.
→ **handleSIGTERM: false** — Playwright ya no atrapa la senal de apagado; la maneja `index.ts`, que si termina el proceso (correccion 1).
→ **on('disconnected')** (al desconectarse) — si Chromium muere, el sandbox se apaga para que Docker lo reemplace; si estaba analizando, primero responde con `navegadorFallo: true` y la pagina sale peligrosa.

*Estos cambios garantizan que un sandbox danado siempre se reinicie en lugar de quedarse inservible.*

---

# Para Arturo

Tu parte de la semana 3 vive en `api/src/analisis/fuentes.ts` y `api/src/analisis/veredicto.ts`.
Ya existen con una version provisional; tu las reemplazas. Lee primero `contrato.ts`.

**Cambio importante respecto a lo que se platico antes:** `revisarFuentes` recibe una
**lista** de enlaces (`urls: string[]`), y **la API ya no expande los enlaces acortados**. El
sandbox ya sigue las redirecciones y te entrega el enlace inicial, cada salto y el final.
Si la API abriera enlaces por su cuenta, una pagina maliciosa podria redirigirla a la base
de datos (ataque SSRF), porque la API si esta en la red interna.

### Que implementar

1. `revisarFuentes(urls)` en `fuentes.ts`:
   - Google Safe Browsing: una sola peticion con todas las URLs.
   - VirusTotal: cuidado con el limite gratuito (4 consultas por minuto); revisa solo el
     enlace final o el inicial, no todos.
   - URLhaus: la URL inicial y la final.
   - Edad del dominio por RDAP (`https://rdap.org/domain/<dominio>`, sin llave).
   - Cada fuente es un `ConsultaFuente` con `consultada`, `malicioso` y un `detalle` en
     lenguaje sencillo, por ejemplo "Google la reporta como sitio de phishing".
2. `calcularVeredicto(fuentes, sandbox)` en `veredicto.ts`: conserva lo que ya hace y agrega
   tus reglas propias como razones de sospecha: marca imitada (titulo de la pagina dice
   BBVA pero el dominio no es de BBVA), terminaciones como `.xyz` o `.top`, IP en lugar de
   dominio, sin HTTPS y demasiados subdominios.

### Reglas

- Nunca abras ni descargues el enlace desde la API; solo consulta las fuentes.
- Si una fuente falla, no hay llave o se excede el limite, regresa `consultada: false`.
  `revisarFuentes` nunca debe lanzar un error.
- Pon un tiempo limite a cada consulta (`AbortSignal.timeout(8_000)`) para que una fuente
  lenta no detenga el analisis.
- Las llaves se leen de `process.env.VIRUSTOTAL_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY` y
  `URLHAUS_AUTH_KEY`. Agrega esas tres variables al servicio `api` (ya estan en `.env`;
  `env_file: .env` las pasa).
- No cambies los tipos de `contrato.ts` sin avisar a Carlos Rafael.

### Para no chocar en Git

Si empiezas antes de que se una `feature/analisis`, escribe cada fuente en su propio
archivo (`virustotal.ts`, `safebrowsing.ts`, `urlhaus.ts`, `rdap.ts`, `reglas.ts`). Cuando
se una, haz `git pull` de `main` en tu rama y conecta todo dentro de `fuentes.ts` y
`veredicto.ts`.

### Como probar

Levanta todo con `docker compose up --build -d` y usa `scripts\probar-analisis.ps1`. El sitio
de prueba de Google (`https://testsafebrowsing.appspot.com/s/phishing.html`) debe pasar de
SEGURO a PELIGROSO cuando tu consulta a Safe Browsing funcione. Para ver lo que respondio
cada fuente, abre el analisis en `/docs` y revisa `detalles.fuentes`.

---

# Preguntas que les pueden hacer

- **¿Por qué no Redis para la fila?** PostgreSQL con `FOR UPDATE SKIP LOCKED` ya garantiza
  que dos trabajadores no tomen el mismo analisis, y no agrega otra pieza que configurar.
  Para el volumen de un proyecto escolar sobra.
- **¿Por qué la API responde antes de tener el resultado?** Un analisis tarda varios
  segundos. Si cada peticion esperara, pocas peticiones simultaneas bloquearian la API.
- **¿Qué pasa si una página tumba un sandbox?** Se marca peligrosa, Docker lo reinicia y el
  siguiente analisis va a otro sandbox. Si fue casualidad, se reintenta una vez en otro.
- **¿Qué pasa si se apaga la API a la mitad?** Al encender, los analisis a medias regresan
  a la fila.
- **¿Por qué guardar la captura en la base de datos?** Es simple y la imagen pesa poco
  (decenas de KB). En un sistema grande iria en almacenamiento de archivos.
- **¿La caché no es un riesgo?** Dura 30 minutos y solo comparte el resultado de un enlace,
  no datos del usuario. Un sitio que cambia de inofensivo a malicioso se vuelve a analizar
  despues de ese tiempo.
