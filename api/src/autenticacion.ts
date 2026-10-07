/**
 * Proteccion de endpoints con JWT.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

/** Se pone en los endpoints que requieren sesion: verifica el token del encabezado Authorization. */
export async function autenticar(peticion: FastifyRequest, respuesta: FastifyReply) {
  try {
    await peticion.jwtVerify();
  } catch {
    return respuesta.code(401).send({ detail: 'Sesion invalida o expirada' });
  }
}
