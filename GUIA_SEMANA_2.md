# Guia de la semana 2: API base

Objetivo de la semana: poder registrarse, iniciar sesion y entrar a un endpoint
protegido, con la API y PostgreSQL corriendo en Docker.

El codigo ya esta escrito y probado contra PostgreSQL 16; esta guia es para meterlo
a tu proyecto, correrlo y entenderlo para defenderlo.

## Paso 1. Crear tu rama

En `C:\Dev\enlaceseguro`:

```
git checkout main
git pull
git checkout -b feature/api-base
```

## Paso 2. Copiar los archivos nuevos

Descomprime el zip nuevo (por ejemplo en `C:\Users\rafar\Downloads\enlaceseguro-s2`) y
copia lo que cambio. Ajusta la primera linea si lo descomprimiste en otro lugar:

```
$nuevo = "C:\Users\rafar\Downloads\enlaceseguro-s2\enlaceseguro"
Copy-Item "$nuevo\api" "C:\Dev\enlaceseguro\" -Recurse -Force
Copy-Item "$nuevo\docker-compose.yml", "$nuevo\.env.example", "$nuevo\README.md", "$nuevo\GUIA_SEMANA_2.md" "C:\Dev\enlaceseguro\" -Force
Copy-Item "$nuevo\scripts\probar-api.ps1" "C:\Dev\enlaceseguro\scripts\" -Force
Copy-Item "$nuevo\sandbox\src\servidor.ts" "C:\Dev\enlaceseguro\sandbox\src\" -Force
```

Tu `.env` no se toca.

## Paso 3. Agregar el secreto JWT a tu .env

Genera una cadena aleatoria:

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Abre `.env` y pegala en la linea `JWT_SECRET=` (sin espacios ni comillas).

No cambies `POSTGRES_PASSWORD`: la base de datos ya se creo con la que pusiste. Si
alguna vez necesitas cambiarla, borra los datos con `docker compose down -v` (esto
elimina todos los usuarios) y vuelve a levantar.

## Paso 4. Levantar todo

```
docker compose up --build -d
docker compose ps
```

Deben aparecer `api`, `db`, `sandbox1`, `sandbox2` y `sandbox3` en estado Up (la base
de datos dice "healthy"). Si `api` no aparece o se reinicia, mira por que:

```
docker compose logs api
```

## Paso 5. Probar

1. Abre `http://127.0.0.1:8000/docs` en el navegador. Es la documentacion automatica:
   ahi se ven todos los endpoints y se pueden probar con el boton "Try it out".

2. Prueba el flujo completo con el script:

```
powershell -ExecutionPolicy Bypass -File scripts\probar-api.ps1
```

Debe crear una cuenta, rechazar la contrasena incorrecta, iniciar sesion, rechazar `/yo`
sin token y saludarte con el token.

3. Comprueba que las contrasenas se guardan cifradas:

```
docker compose exec db psql -U enlaceseguro -d enlaceseguro -c "SELECT correo, password_hash FROM usuarios;"
```

En lugar de la contrasena veras algo como `$2b$12$...`: es el hash de bcrypt. Toma
captura: es evidencia para la presentacion.

## Paso 6. Subirlo

```
git add .
git commit -m "API base: registro, login con JWT y PostgreSQL"
git push -u origin feature/api-base
```

En GitHub abre un pull request de `feature/api-base` a `main` y pide a Arturo que lo
revise antes de unirlo.

## Que ya se probo

Contra PostgreSQL 16 real, con la API normal y con la version compilada:

- Registro correcto: 201, y en la base de datos la contrasena aparece como hash `$2b$12$`.
- Mismo correo con otras mayusculas: 409 (los correos se guardan en minusculas).
- Correo invalido, contrasena de menos de 8 caracteres, campos extra como `esAdmin`,
  JSON roto y cuerpos de mas de 10 KB: rechazados con 400 o 413.
- Login con contrasena incorrecta y con correo inexistente: el mismo 401 y el mismo mensaje.
- Login correcto: token JWT que expira en 1 hora.
- `/yo` sin token, con token inventado y con un token "alg: none" (ataque conocido a JWT):
  rechazados con 401.
- `/yo` con token valido: responde los datos del usuario.
- Sexto intento de login en el mismo minuto: 429.
- La documentacion en `/docs` se genera.

Lo que falta confirmar en tu PC es que todo funcione dentro de Docker (pasos 4 y 5).

---

# Explicacion del codigo

La API esta dividida por responsabilidad, igual que el sandbox:

- `config.ts`: lee el `.env`.
- `db.ts`: conexion a PostgreSQL y tablas.
- `autenticacion.ts`: verificacion del token.
- `rutas/auth.ts`: registro y login.
- `rutas/usuario.ts`: el endpoint protegido `/yo`.
- `app.ts`: arma la aplicacion con sus plugins de seguridad.
- `index.ts`: solo la enciende.

## config.ts

```ts
function requerida(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} en el archivo .env`);
  return valor;
}

export function leerConfiguracion(): Configuracion {
  const secretoJwt = requerida('JWT_SECRET');
  if (secretoJwt.length < 32) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
  }
  return {
    puerto: Number(process.env.PUERTO ?? 8000),
    baseDeDatos: {
      host: process.env.DB_HOST ?? 'db',
      ...
      password: requerida('POSTGRES_PASSWORD'),
      ...
    },
    secretoJwt,
  };
}
```

→ **process.env** (entorno del proceso) — las variables que Docker toma del `.env`.
→ **requerida** — si falta una variable, la API se niega a arrancar.
→ **throw new Error** (lanzar error) — detiene el arranque con un mensaje claro.
→ **length < 32** (longitud menor a 32) — un secreto corto se puede adivinar por fuerza bruta y con el se podrian fabricar tokens validos.
→ **?? 8000** (si no hay valor, usar 8000) — valores por defecto para lo que no es secreto.
→ **DB_HOST ?? 'db'** — dentro de Docker, la base de datos se llama `db`.

*Este archivo junta la configuracion y prefiere fallar al arrancar antes que funcionar de forma insegura.*

## db.ts

```ts
export function crearConexion(config: Configuracion['baseDeDatos']): BaseDeDatos {
  return new pg.Pool({ ...config, max: 10 });
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        VARCHAR(80)  NOT NULL,
  correo        VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS analisis (
  ...
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado     VARCHAR(12) NOT NULL DEFAULT 'pendiente'
             CHECK (estado IN ('pendiente', 'procesando', 'terminado', 'error')),
  veredicto  VARCHAR(12) CHECK (veredicto IN ('seguro', 'sospechoso', 'peligroso')),
  resultado  JSONB,
  ...
);
CREATE INDEX IF NOT EXISTS analisis_pendientes_idx ON analisis (creado_en) WHERE estado = 'pendiente';
`;
```

→ **pg.Pool** (grupo de conexiones) — mantiene hasta 10 conexiones abiertas y las reutiliza, en lugar de abrir una por peticion.
→ **CREATE TABLE IF NOT EXISTS** (crear tabla si no existe) — se ejecuta en cada arranque sin romper nada.
→ **UUID ... gen_random_uuid()** (identificador unico universal) — ids aleatorios en lugar de 1, 2, 3; asi nadie puede adivinar los ids de otros usuarios.
→ **correo ... UNIQUE** (unico) — la base de datos impide dos cuentas con el mismo correo.
→ **password_hash** — nunca se guarda la contrasena, solo su hash.
→ **REFERENCES usuarios(id) ON DELETE CASCADE** (referencia, al borrar en cascada) — cada analisis pertenece a un usuario; si se borra el usuario, se borran sus analisis.
→ **CHECK (estado IN (...))** (revisar) — la base de datos solo acepta esos estados; protege contra valores inventados.
→ **JSONB** — guarda el reporte completo del sandbox y de las fuentes de amenazas.
→ **CREATE INDEX ... WHERE estado = 'pendiente'** (indice parcial) — busca rapido el siguiente analisis de la fila; se usa en la semana 3.

*Este archivo crea las tablas de usuarios y de analisis, con reglas que la propia base de datos hace cumplir.*

## autenticacion.ts

```ts
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

export async function autenticar(peticion: FastifyRequest, respuesta: FastifyReply) {
  try {
    await peticion.jwtVerify();
  } catch {
    return respuesta.code(401).send({ detail: 'Sesion invalida o expirada' });
  }
}
```

→ **declare module** (declarar modulo) — le dice a TypeScript que el token solo lleva `sub`, el id del usuario.
→ **sub** (subject, sujeto) — nombre estandar del campo que dice de quien es el token.
→ **jwtVerify()** (verificar JWT) — revisa la firma con el secreto y que no haya expirado. Si alguien modifica el token, la firma ya no coincide.
→ **code(401)** — "no autorizado"; el mismo mensaje para token falso, vencido o ausente.

*Este archivo es el guardia de los endpoints protegidos: sin un token valido no se entra.*

## rutas/auth.ts, bloque 1: constantes y validacion

```ts
const RONDAS_BCRYPT = 12;
const DURACION_TOKEN_S = 60 * 60;
const HASH_FALSO = bcrypt.hashSync('contrasena-que-no-existe', RONDAS_BCRYPT);

const esquemaRegistro = {
  body: {
    type: 'object',
    required: ['nombre', 'correo', 'password'],
    additionalProperties: false,
    properties: {
      nombre: { type: 'string', minLength: 2, maxLength: 80 },
      correo: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 72 },
    },
  },
  response: { 201: { type: 'object', properties: { id: ..., nombre: ..., correo: ... } } },
};
```

→ **RONDAS_BCRYPT = 12** (rondas) — bcrypt repite el calculo 2^12 veces; tarda unos 250 ms por contrasena. Para un usuario no se nota, pero hace muy lento probar millones de contrasenas si roban la base de datos.
→ **DURACION_TOKEN_S** — el token vale 1 hora; si lo roban, sirve poco tiempo.
→ **HASH_FALSO** — se explica en el bloque del login.
→ **format: 'email'** (formato correo) — Fastify rechaza lo que no sea un correo.
→ **minLength: 8** (longitud minima) — contrasenas de al menos 8 caracteres.
→ **maxLength: 72** (longitud maxima) — bcrypt solo usa los primeros 72 bytes; mas largo daria una falsa sensacion de seguridad.
→ **additionalProperties: false** — rechaza campos extra. Evita que alguien mande `"esAdmin": true` esperando que se guarde (ataque de asignacion masiva).
→ **response: { 201: ... }** (respuesta) — Fastify solo envia esos campos; aunque por error se consultara el hash, nunca saldria en la respuesta.

*Este bloque define que datos se aceptan y que datos pueden salir.*

## rutas/auth.ts, bloque 2: registro

```ts
app.post<{ Body: CuerpoRegistro }>('/registro', { schema: esquemaRegistro }, async (peticion, respuesta) => {
  const nombre = peticion.body.nombre.trim();
  const correo = peticion.body.correo.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(peticion.body.password, RONDAS_BCRYPT);
  try {
    const { rows } = await db.query(
      'INSERT INTO usuarios (nombre, correo, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, correo',
      [nombre, correo, passwordHash],
    );
    return respuesta.code(201).send(rows[0]);
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      return respuesta.code(409).send({ detail: 'Ese correo ya esta registrado' });
    }
    throw error;
  }
});
```

→ **trim().toLowerCase()** (quitar espacios, minusculas) — Rafael@Ejemplo.com y rafael@ejemplo.com son la misma cuenta.
→ **bcrypt.hash** — convierte la contrasena en un hash con "sal" aleatoria: dos usuarios con la misma contrasena tienen hashes distintos.
→ **$1, $2, $3** (parametros) — los valores viajan separados de la consulta; eso impide la inyeccion SQL.
→ **RETURNING** (regresar) — devuelve el usuario creado sin otra consulta.
→ **code(201)** — "creado".
→ **'23505'** — codigo de PostgreSQL para "valor duplicado" en la columna UNIQUE.
→ **code(409)** — "conflicto": el correo ya existe.
→ **throw error** — cualquier otro error lo responde el manejador general con un 500 sin detalles.

*Este bloque crea la cuenta guardando solo el hash de la contrasena y protegido contra inyeccion SQL.*

## rutas/auth.ts, bloque 3: login

```ts
app.post<{ Body: CuerpoLogin }>(
  '/login',
  { schema: esquemaLogin, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
  async (peticion, respuesta) => {
    const correo = peticion.body.correo.trim().toLowerCase();
    const { rows } = await db.query('SELECT id, password_hash FROM usuarios WHERE correo = $1', [correo]);
    const usuario = rows[0];

    const valida = await bcrypt.compare(peticion.body.password, usuario?.password_hash ?? HASH_FALSO);
    if (!usuario || !valida) {
      return respuesta.code(401).send({ detail: 'Correo o contrasena incorrectos' });
    }

    const token = app.jwt.sign({ sub: usuario.id }, { expiresIn: DURACION_TOKEN_S });
    return { token, tipo: 'Bearer', expiraEn: DURACION_TOKEN_S };
  },
);
```

→ **rateLimit: { max: 5, timeWindow: '1 minute' }** (limite de peticiones) — maximo 5 intentos por minuto desde la misma IP; frena los ataques de fuerza bruta.
→ **bcrypt.compare** (comparar) — calcula el hash de lo que escribio el usuario y lo compara con el guardado.
→ **?? HASH_FALSO** — si el correo no existe, compara de todos modos contra un hash falso. Asi la respuesta tarda lo mismo exista o no el correo, y un atacante no puede averiguar por el tiempo que correos estan registrados.
→ **!usuario || !valida** — el mismo 401 y el mismo mensaje en ambos casos, por la misma razon.
→ **jwt.sign** (firmar) — crea el token con el id del usuario y lo firma con `JWT_SECRET`.
→ **tipo: 'Bearer'** (portador) — la app lo manda como `Authorization: Bearer <token>`.

*Este bloque inicia sesion sin revelar que correos existen y limitando los intentos.*

## rutas/usuario.ts

```ts
app.get('/yo', { schema: esquemaYo, onRequest: autenticar }, async (peticion, respuesta) => {
  const { rows } = await db.query(
    'SELECT id, nombre, correo, creado_en AS "creadoEn" FROM usuarios WHERE id = $1',
    [peticion.user.sub],
  );
  if (!rows[0]) return respuesta.code(404).send({ detail: 'Usuario no encontrado' });
  return rows[0];
});
```

→ **onRequest: autenticar** (al recibir la peticion) — el guardia se ejecuta antes que todo; sin token valido ni siquiera se consulta la base de datos.
→ **peticion.user.sub** — el id sale del token firmado, no de lo que mande el usuario; nadie puede pedir los datos de otro.
→ **AS "creadoEn"** (como) — renombra la columna al estilo de TypeScript.
→ **code(404)** — "no encontrado", por si el usuario se borro y su token sigue vigente.

*Este endpoint demuestra que la proteccion con JWT funciona: solo responde a quien tiene sesion.*

## app.ts

```ts
const app = Fastify({
  logger: registros,
  bodyLimit: 10_000,
  ajv: { customOptions: { removeAdditional: false } },
});

await app.register(fastifyRateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(fastifyJwt, {
  secret: config.secretoJwt,
  verify: { algorithms: ['HS256'] },
});
await app.register(fastifySwagger, { openapi: { ... } });
await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

app.setErrorHandler((error, peticion, respuesta) => {
  if (error.validation) return respuesta.code(400).send({ detail: 'Datos invalidos', errores: ... });
  if (error.statusCode === 429) return respuesta.code(429).send({ detail: 'Demasiadas peticiones; intenta en un minuto' });
  if (error.statusCode && error.statusCode < 500) return respuesta.code(error.statusCode).send({ detail: error.message });
  peticion.log.error(error);
  return respuesta.code(500).send({ detail: 'Error interno' });
});

await app.register(rutasAuth, { prefix: '/auth', db });
await app.register(rutasUsuario, { db });
```

→ **logger** (registro) — anota cada peticion en la consola; lo ves con `docker compose logs api`.
→ **bodyLimit: 10_000** (limite del cuerpo) — rechaza cuerpos de mas de 10 KB con 413.
→ **removeAdditional: false** (no quitar adicionales) — por defecto Fastify borraria los campos extra en silencio; asi los rechaza con 400.
→ **fastifyRateLimit** (limite de peticiones) — 300 peticiones por minuto por IP en toda la API (en la semana 3 se subio de 100 a 300 porque la app consulta el resultado cada 2 segundos); el login tiene su propio limite de 5.
→ **fastifyJwt** — agrega `jwt.sign` y `jwtVerify`.
→ **algorithms: ['HS256']** (algoritmos) — solo acepta tokens firmados con nuestro algoritmo. Bloquea el ataque "alg: none", donde el atacante manda un token sin firma (esta en las pruebas).
→ **fastifySwagger / fastifySwaggerUi** — generan la documentacion en `/docs` a partir de los esquemas.
→ **setErrorHandler** (manejador de errores) — todas las respuestas de error tienen la forma `{ detail }`.
→ **error.validation** — errores de los esquemas: 400 con la lista de campos mal.
→ **code(500) 'Error interno'** — los errores inesperados se anotan en el registro pero al usuario no se le muestran detalles internos, que podrian ayudar a un atacante.
→ **register(rutasAuth, { prefix: '/auth' })** (registrar con prefijo) — las rutas de auth quedan en `/auth/registro` y `/auth/login`.

*Este archivo arma la API con sus capas de seguridad antes de las rutas.*

## index.ts

```ts
const config = leerConfiguracion();
const db = crearConexion(config.baseDeDatos);
await esperarBaseDeDatos(db);
await migrar(db);
const app = await construirApp(config, db);
await app.listen({ host: '0.0.0.0', port: config.puerto });

process.on('SIGTERM', async () => {
  await app.close();
  await db.end();
  process.exit(0);
});
```

→ **esperarBaseDeDatos** — reintenta cada 2 segundos mientras PostgreSQL termina de arrancar.
→ **migrar** — crea las tablas si no existen.
→ **host: '0.0.0.0'** — escucha en todas las interfaces del contenedor, para que Docker le pase las peticiones.
→ **process.on('SIGTERM')** (al recibir la senal de terminar) — cuando Docker apaga el contenedor, cierra el servidor y las conexiones de forma ordenada.

*Este archivo solo enciende la API en el orden correcto; no tiene logica.*

## Docker: Dockerfile y docker-compose.yml

```dockerfile
FROM node:22-slim AS construccion
...
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
COPY --from=construccion /app/node_modules ./node_modules
COPY --from=construccion /app/dist ./dist
USER node
```

```yaml
api:
  env_file: .env
  read_only: true
  cap_drop: [ALL]
  depends_on:
    db:
      condition: service_healthy
  networks: [red_interna, red_sandbox]
db:
  environment:
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
```

→ **AS construccion** (etapa de construccion) — compila en una etapa y copia solo el resultado a la imagen final; la imagen queda sin TypeScript ni herramientas de desarrollo.
→ **npm prune --omit=dev** (podar sin desarrollo) — quita las dependencias que solo sirven para compilar.
→ **USER node** — la API corre sin privilegios de administrador.
→ **env_file: .env** — la API recibe sus secretos del `.env`.
→ **read_only: true / cap_drop: [ALL]** — mismas restricciones que el sandbox: el contenedor no puede modificarse ni usar permisos especiales.
→ **condition: service_healthy** (condicion: servicio sano) — la API no arranca hasta que PostgreSQL responde.
→ **networks: [red_interna, red_sandbox]** — la API es la unica que ve la base de datos y tambien los sandboxes.
→ **db: environment** — la base de datos solo recibe sus propios datos; no conoce el secreto JWT ni las llaves de las fuentes de amenazas (principio de minimo privilegio).
→ **pg_isready** — comando de PostgreSQL que responde si ya acepta conexiones.

*Esta configuracion aplica a la API las mismas capas de aislamiento que al sandbox.*

## Preguntas que les pueden hacer

- **¿Por qué bcryptjs y no bcrypt?** Es el mismo algoritmo y produce los mismos hashes
  (`$2b$`). Esta escrito en JavaScript puro, asi que no necesita compilar codigo nativo
  en Windows ni en Docker.
- **¿Por qué el registro sí dice que el correo existe?** El usuario necesita saber por
  que no puede registrarse. El riesgo de que se averigüen correos se reduce con el
  limite de 300 peticiones por minuto; el login, que es lo que se ataca con fuerza
  bruta, no revela nada.
- **¿Qué pasa si roban la base de datos?** Solo obtienen hashes bcrypt con 12 rondas y
  sal propia: no se pueden revertir y adivinarlos uno por uno es muy lento.
- **¿Qué pasa si roban un token?** Vale maximo una hora y solo da acceso a la cuenta de
  ese usuario.
- **¿Por qué la base de datos no tiene puerto abierto?** Esta en una red interna sin
  salida a internet; solo la API puede hablar con ella.
