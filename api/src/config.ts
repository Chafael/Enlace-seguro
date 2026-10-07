/**
 * Lee la configuracion de las variables de entorno (archivo .env).
 * Si falta algo importante, la API no arranca: es mejor fallar al inicio
 * que funcionar con una configuracion insegura.
 */
export interface Configuracion {
  puerto: number;
  baseDeDatos: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  secretoJwt: string;
  sandboxes: string[];
}

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
      port: Number(process.env.DB_PUERTO ?? 5432),
      user: requerida('POSTGRES_USER'),
      password: requerida('POSTGRES_PASSWORD'),
      database: requerida('POSTGRES_DB'),
    },
    secretoJwt,
    sandboxes: (process.env.SANDBOXES ?? 'http://sandbox1:9000,http://sandbox2:9000,http://sandbox3:9000')
      .split(',')
      .map((direccion) => direccion.trim())
      .filter(Boolean),
  };
}
