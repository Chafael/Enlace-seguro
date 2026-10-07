/**
 * Arma la aplicacion: plugins de seguridad, documentacion y rutas.
 * Recibe la configuracion y la base de datos para poder probarla con otras.
 */
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError } from 'fastify';
import type { Configuracion } from './config.js';
import type { BaseDeDatos } from './db.js';
import { rutasAuth } from './rutas/auth.js';
import { rutasUsuario } from './rutas/usuario.js';

export async function construirApp(config: Configuracion, db: BaseDeDatos, registros = true) {
  const app = Fastify({
    logger: registros,
    bodyLimit: 10_000, // 10 KB: suficiente para un enlace, evita cuerpos gigantes
    ajv: { customOptions: { removeAdditional: false } }, // rechaza campos extra en lugar de borrarlos
  });

  // ---------- Seguridad ----------
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(fastifyJwt, {
    secret: config.secretoJwt,
    verify: { algorithms: ['HS256'] }, // solo acepta tokens firmados como los nuestros
  });

  // ---------- Documentacion en /docs ----------
  await app.register(fastifySwagger, {
    openapi: {
      info: { title: 'EnlaceSeguro API', version: '1.0.0' },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  // ---------- Errores sin detalles internos ----------
  app.setErrorHandler((error: FastifyError, peticion, respuesta) => {
    if (error.validation) {
      return respuesta.code(400).send({
        detail: 'Datos invalidos',
        errores: error.validation.map((e) => `${e.instancePath || 'cuerpo'} ${e.message}`),
      });
    }
    if (error.statusCode === 429) {
      return respuesta.code(429).send({ detail: 'Demasiadas peticiones; intenta en un minuto' });
    }
    if (error.statusCode && error.statusCode < 500) {
      return respuesta.code(error.statusCode).send({ detail: error.message });
    }
    peticion.log.error(error);
    return respuesta.code(500).send({ detail: 'Error interno' });
  });

  // ---------- Rutas ----------
  app.get('/salud', { schema: { tags: ['salud'] } }, async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });
  await app.register(rutasAuth, { prefix: '/auth', db });
  await app.register(rutasUsuario, { db });

  return app;
}
