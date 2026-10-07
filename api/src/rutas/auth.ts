/**
 * Registro e inicio de sesion.
 */
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { BaseDeDatos } from '../db.js';

const RONDAS_BCRYPT = 12;
const DURACION_TOKEN_S = 60 * 60; // 1 hora

// Hash de una contrasena que nadie usa. Se compara contra el cuando el correo no existe,
// para que la respuesta tarde lo mismo y no revele que correos estan registrados.
const HASH_FALSO = bcrypt.hashSync('contrasena-que-no-existe', RONDAS_BCRYPT);

interface CuerpoRegistro {
  nombre: string;
  correo: string;
  password: string;
}

interface CuerpoLogin {
  correo: string;
  password: string;
}

const esquemaRegistro = {
  tags: ['auth'],
  summary: 'Crear una cuenta',
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
  response: {
    201: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nombre: { type: 'string' },
        correo: { type: 'string' },
      },
    },
  },
} as const;

const esquemaLogin = {
  tags: ['auth'],
  summary: 'Iniciar sesion y recibir un token',
  body: {
    type: 'object',
    required: ['correo', 'password'],
    additionalProperties: false,
    properties: {
      correo: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 72 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        tipo: { type: 'string' },
        expiraEn: { type: 'number' },
      },
    },
  },
} as const;

export async function rutasAuth(app: FastifyInstance, opciones: { db: BaseDeDatos }) {
  const { db } = opciones;

  // ---------- POST /auth/registro ----------
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

  // ---------- POST /auth/login ----------
  app.post<{ Body: CuerpoLogin }>(
    '/login',
    {
      schema: esquemaLogin,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, // contra fuerza bruta
    },
    async (peticion, respuesta) => {
      const correo = peticion.body.correo.trim().toLowerCase();
      const { rows } = await db.query<{ id: string; password_hash: string }>(
        'SELECT id, password_hash FROM usuarios WHERE correo = $1',
        [correo],
      );
      const usuario = rows[0];

      const valida = await bcrypt.compare(peticion.body.password, usuario?.password_hash ?? HASH_FALSO);
      if (!usuario || !valida) {
        return respuesta.code(401).send({ detail: 'Correo o contrasena incorrectos' });
      }

      const token = app.jwt.sign({ sub: usuario.id }, { expiresIn: DURACION_TOKEN_S });
      return { token, tipo: 'Bearer', expiraEn: DURACION_TOKEN_S };
    },
  );
}
