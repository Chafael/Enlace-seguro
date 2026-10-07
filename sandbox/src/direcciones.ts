/**
 * Bloqueo de direcciones internas (anti-SSRF).
 * Una pagina maliciosa nunca debe poder usar el sandbox para llegar a la API,
 * a la base de datos o a la red local.
 */
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const NOMBRES_BLOQUEADOS = new Set(['localhost', 'api', 'db', 'sandbox1', 'sandbox2', 'sandbox3']);

export type RevisorDeDirecciones = (host: string) => Promise<boolean>;

/** true si el host es un nombre interno o resuelve a una IP que no es publica. */
export async function esDireccionInterna(host: string): Promise<boolean> {
  const nombre = host.toLowerCase().replace(/^\[|\]$/g, ''); // IPv6 llega como [::1]
  if (!nombre) return true;
  if (NOMBRES_BLOQUEADOS.has(nombre)) return true;

  let direcciones: { address: string }[];
  try {
    direcciones = await lookup(nombre, { all: true });
  } catch {
    return false; // el dominio no existe: el navegador fallara solo
  }

  return direcciones.some(({ address }) => {
    let ip = ipaddr.parse(address);
    if (ip instanceof ipaddr.IPv6 && ip.isIPv4MappedAddress()) {
      ip = ip.toIPv4Address(); // ::ffff:127.0.0.1 tambien es localhost
    }
    return ip.range() !== 'unicast'; // privada, loopback, linkLocal, reservada...
  });
}
