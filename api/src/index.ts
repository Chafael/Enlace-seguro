import { iniciarProcesador, type Procesador } from './analisis/procesador.js';
import { ClienteSandboxes } from './analisis/sandboxes.js';
import { construirApp } from './app.js';
import { leerConfiguracion } from './config.js';
import { crearConexion, esperarBaseDeDatos, migrar } from './db.js';

const config = leerConfiguracion();
const db = crearConexion(config.baseDeDatos);

await esperarBaseDeDatos(db);
await migrar(db);

let procesador: Procesador | undefined;
const app = await construirApp(config, db, () => procesador?.avisar());
await app.listen({ host: '0.0.0.0', port: config.puerto });

// Un trabajador por sandbox: cada uno toma un analisis de la fila a la vez
const sandboxes = new ClienteSandboxes(config.sandboxes);
procesador = await iniciarProcesador(db, sandboxes, config.sandboxes.length, app.log);
app.log.info(`Procesador iniciado con ${config.sandboxes.length} sandboxes`);

// Apagado ordenado cuando Docker detiene el contenedor
process.on('SIGTERM', async () => {
  await app.close();
  await procesador?.detener();
  await db.end();
  process.exit(0);
});
