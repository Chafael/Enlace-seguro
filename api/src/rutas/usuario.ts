/**
 * Datos del usuario con sesion. Es el endpoint protegido de prueba de la semana 2.
 */
import type { FastifyInstance } from 'fastify';
import { autenticar } from '../autenticacion.js';
import type { BaseDeDatos } from '../db.js';

const esquemaYo = {
  tags: ['usuario'],
  summary: 'Datos del usuario con sesion',
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nombre: { type: 'string' },
        correo: { type: 'string' },
        creadoEn: { type: 'string' },
      },
    },
    404: { type: 'object', properties: { detail: { type: 'string' } } },
  },
} as const;

export async function rutasUsuario(app: FastifyInstance, opciones: { db: BaseDeDatos }) {
  const { db } = opciones;

  app.get('/yo', { schema: esquemaYo, onRequest: autenticar }, async (peticion, respuesta) => {
    const { rows } = await db.query(
      'SELECT id, nombre, correo, creado_en AS "creadoEn" FROM usuarios WHERE id = $1',
      [peticion.user.sub],
    );
    if (!rows[0]) return respuesta.code(404).send({ detail: 'Usuario no encontrado' });
    return rows[0];
  });
}
