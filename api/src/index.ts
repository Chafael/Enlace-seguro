import { construirApp } from './app.js';
import { leerConfiguracion } from './config.js';
import { crearConexion, esperarBaseDeDatos, migrar } from './db.js';

const config = leerConfiguracion();
const db = crearConexion(config.baseDeDatos);

await esperarBaseDeDatos(db);
await migrar(db);

const app = await construirApp(config, db);
await app.listen({ host: '0.0.0.0', port: config.puerto });

// Apagado ordenado cuando Docker detiene el contenedor
process.on('SIGTERM', async () => {
  await app.close();
  await db.end();
  process.exit(0);
});
