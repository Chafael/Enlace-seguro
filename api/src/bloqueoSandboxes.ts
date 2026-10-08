/**
 * Bloquea cualquier peticion que llegue desde un sandbox.
 *
 * La API necesita estar en la red de cada sandbox para mandarle enlaces, y Docker no
 * permite redes de un solo sentido: un sandbox podria conectarse a la API. Normalmente
 * no pasa (el navegador bloquea las direcciones internas), pero si una pagina lograra
 * tomar el control del contenedor, esta segunda barrera responde 403.
 *
 * Los sandboxes no pueden falsificar su IP: corren con cap_drop: [ALL] (sin NET_RAW).
 */
import { lookup } from 'node:dns/promises';
import type { FastifyInstance } from 'fastify';

const VIGENCIA_MS = 5_000; // las IPs cambian si un sandbox se reinicia: se vuelven a consultar
const LOCALES = new Set(['127.0.0.1', '::1']); // en desarrollo sin Docker no se bloquea a uno mismo

export type Resolver = (host: string, opciones: { all: true }) => Promise<{ address: string }[]>;

const normalizar = (ip: string) => (ip.startsWith('::ffff:') ? ip.slice(7) : ip);

export function registrarBloqueoDeSandboxes(app: FastifyInstance, direcciones: string[], resolver: Resolver = lookup) {
  const nombres = [...new Set(direcciones.map((direccion) => new URL(direccion).hostname))];
  let memoria = { ips: new Set<string>(), hasta: 0 };

  async function ipsDeSandboxes() {
    if (Date.now() < memoria.hasta) return memoria.ips;
    const ips = new Set<string>();
    await Promise.all(
      nombres.map(async (nombre) => {
        try {
          for (const { address } of await resolver(nombre, { all: true })) {
            const ip = normalizar(address);
            if (!LOCALES.has(ip)) ips.add(ip);
          }
        } catch {
          // un sandbox que se esta reiniciando no resuelve: se ignora hasta la siguiente consulta
        }
      }),
    );
    memoria = { ips, hasta: Date.now() + VIGENCIA_MS };
    return ips;
  }

  app.addHook('onRequest', async (peticion, respuesta) => {
    const origen = normalizar(peticion.socket.remoteAddress ?? '');
    if ((await ipsDeSandboxes()).has(origen)) {
      peticion.log.warn({ origen }, 'Peticion desde un sandbox bloqueada');
      return respuesta.code(403).send({ detail: 'Acceso denegado' });
    }
  });
}
