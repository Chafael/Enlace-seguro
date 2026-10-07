import { crearServidor } from './servidor.js';

const puerto = Number(process.env.PUERTO ?? 9000);
const app = crearServidor();

await app.listen({ host: '0.0.0.0', port: puerto });
console.log(`Sandbox escuchando en el puerto ${puerto}`);

// Apagado ordenado cuando Docker detiene el contenedor
for (const senal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(senal, async () => {
    await app.close();
    process.exit(0);
  });
}
