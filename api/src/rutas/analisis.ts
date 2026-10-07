/**
 * Endpoints de analisis: crear uno, consultar su resultado y ver el historial.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { extraerEnlace } from '../analisis/enlace.js';
import { autenticar } from '../autenticacion.js';
import type { BaseDeDatos } from '../db.js';

const MAX_EN_PROCESO = 3; // por usuario: nadie puede acaparar los sandboxes
const MINUTOS_CACHE = 30; // si alguien reviso el mismo enlace hace poco, se reutiliza

interface OpcionesRutas {
  db: BaseDeDatos;
  avisar: () => void;
}

const error = { type: 'object', properties: { detail: { type: 'string' } } } as const;

const esquemaCrear = {
  tags: ['analisis'],
  summary: 'Analizar un enlace (o un mensaje completo que lo contenga)',
  security: [{ bearerAuth: [] }],
  body: {
    type: 'object',
    required: ['texto'],
    additionalProperties: false,
    properties: { texto: { type: 'string', minLength: 1, maxLength: 4000 } },
  },
  response: {
    202: {
      type: 'object',
      properties: { id: { type: 'string' }, estado: { type: 'string' }, url: { type: 'string' } },
    },
    400: error,
    429: error,
  },
} as const;

const esquemaConsultar = {
  tags: ['analisis'],
  summary: 'Estado y resultado de un analisis',
  security: [{ bearerAuth: [] }],
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        url: { type: 'string' },
        estado: { type: 'string' },
        veredicto: { type: ['string', 'null'] },
        razones: { type: 'array', items: { type: 'string' } },
        urlFinal: { type: ['string', 'null'] },
        captura: { type: ['string', 'null'] },
        desdeCache: { type: 'boolean' },
        detalles: { type: ['object', 'null'], additionalProperties: true },
        creadoEn: { type: 'string' },
        actualizadoEn: { type: 'string' },
      },
    },
    404: error,
  },
} as const;

const esquemaHistorial = {
  tags: ['analisis'],
  summary: 'Analisis del usuario, del mas reciente al mas antiguo',
  security: [{ bearerAuth: [] }],
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { limite: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
  },
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          url: { type: 'string' },
          estado: { type: 'string' },
          veredicto: { type: ['string', 'null'] },
          creadoEn: { type: 'string' },
        },
      },
    },
  },
} as const;

export async function rutasAnalisis(app: FastifyInstance, opciones: OpcionesRutas) {
  const { db, avisar } = opciones;
  app.addHook('onRequest', autenticar); // todas las rutas de este archivo requieren sesion

  // ---------- POST /analisis ----------
  app.post<{ Body: { texto: string } }>(
    '/analisis',
    {
      schema: esquemaCrear,
      config: {
        // 10 por minuto POR USUARIO (no por IP: en el Wi-Fi de la escuela todos comparten IP).
        // preHandler corre despues de autenticar, cuando ya se sabe quien es.
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (peticion: FastifyRequest) => `usuario:${peticion.user.sub}`,
        },
      },
    },
    async (peticion, respuesta) => {
      const usuarioId = peticion.user.sub;
      const url = extraerEnlace(peticion.body.texto);
      if (!url) return respuesta.code(400).send({ detail: 'No se encontro un enlace http o https en el texto' });

      const enProceso = await db.query<{ total: number }>(
        "SELECT count(*)::int AS total FROM analisis WHERE usuario_id = $1 AND estado IN ('pendiente', 'procesando')",
        [usuarioId],
      );
      if (enProceso.rows[0].total >= MAX_EN_PROCESO) {
        return respuesta.code(429).send({ detail: `Ya tienes ${MAX_EN_PROCESO} analisis en proceso; espera a que terminen` });
      }

      // Cache: el mismo enlace se reviso hace poco (por cualquier usuario).
      const reciente = await db.query(
        `SELECT veredicto, resultado, captura FROM analisis
         WHERE url = $1 AND estado = 'terminado' AND actualizado_en > now() - make_interval(mins => $2)
         ORDER BY actualizado_en DESC LIMIT 1`,
        [url, MINUTOS_CACHE],
      );
      if (reciente.rows[0]) {
        const { veredicto, resultado, captura } = reciente.rows[0];
        const { rows } = await db.query(
          `INSERT INTO analisis (usuario_id, url, estado, veredicto, resultado, captura)
           VALUES ($1, $2, 'terminado', $3, $4, $5) RETURNING id, estado, url`,
          [usuarioId, url, veredicto, { ...resultado, desdeCache: true }, captura],
        );
        return respuesta.code(202).send(rows[0]);
      }

      const { rows } = await db.query(
        'INSERT INTO analisis (usuario_id, url) VALUES ($1, $2) RETURNING id, estado, url',
        [usuarioId, url],
      );
      avisar();
      return respuesta.code(202).send(rows[0]);
    },
  );

  // ---------- GET /analisis/:id ----------
  app.get<{ Params: { id: string } }>('/analisis/:id', { schema: esquemaConsultar }, async (peticion, respuesta) => {
    const { rows } = await db.query(
      `SELECT id, url, estado, veredicto, resultado, captura,
              creado_en AS "creadoEn", actualizado_en AS "actualizadoEn"
       FROM analisis WHERE id = $1 AND usuario_id = $2`,
      [peticion.params.id, peticion.user.sub],
    );
    const fila = rows[0];
    // 404 tambien si es de otro usuario: asi no se revela que existe.
    if (!fila) return respuesta.code(404).send({ detail: 'Analisis no encontrado' });

    const resultado = fila.resultado ?? {};
    return {
      id: fila.id,
      url: fila.url,
      estado: fila.estado,
      veredicto: fila.veredicto,
      razones: resultado.razones ?? (resultado.detalle ? [resultado.detalle] : []),
      urlFinal: resultado.urlFinal ?? null,
      captura: fila.captura,
      desdeCache: resultado.desdeCache === true,
      detalles: fila.estado === 'terminado' ? { sandbox: resultado.sandbox, fuentes: resultado.fuentes } : null,
      creadoEn: fila.creadoEn.toISOString(),
      actualizadoEn: fila.actualizadoEn.toISOString(),
    };
  });

  // ---------- GET /historial ----------
  app.get<{ Querystring: { limite: number } }>('/historial', { schema: esquemaHistorial }, async (peticion) => {
    const { rows } = await db.query(
      `SELECT id, url, estado, veredicto, creado_en AS "creadoEn"
       FROM analisis WHERE usuario_id = $1
       ORDER BY creado_en DESC LIMIT $2`,
      [peticion.user.sub, peticion.query.limite],
    );
    return rows.map((fila) => ({ ...fila, creadoEn: fila.creadoEn.toISOString() }));
  });
}
