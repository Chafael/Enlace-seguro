/**
 * Conexion a PostgreSQL y creacion de las tablas.
 */
import pg from 'pg';
import type { Configuracion } from './config.js';

export type BaseDeDatos = pg.Pool;

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
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  url            TEXT NOT NULL,
  estado         VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente', 'procesando', 'terminado', 'error')),
  veredicto      VARCHAR(12)
                 CHECK (veredicto IN ('seguro', 'sospechoso', 'peligroso')),
  resultado      JSONB,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analisis_usuario_idx ON analisis (usuario_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS analisis_pendientes_idx ON analisis (creado_en) WHERE estado = 'pendiente';
`;

/** Crea las tablas si no existen. Se puede ejecutar cada vez que arranca la API. */
export async function migrar(db: BaseDeDatos): Promise<void> {
  await db.query(ESQUEMA);
}

/** Espera a que PostgreSQL acepte conexiones (al encender Docker tarda unos segundos). */
export async function esperarBaseDeDatos(db: BaseDeDatos, intentos = 15): Promise<void> {
  for (let intento = 1; intento <= intentos; intento++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch (error) {
      if (intento === intentos) throw error;
      await new Promise((resolver) => setTimeout(resolver, 2_000));
    }
  }
}
