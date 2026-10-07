/**
 * Servidor HTTP del sandbox. Atiende un solo analisis a la vez y, si detecta
 * algo malo, responde y despues termina el proceso para que Docker lo
 * vuelva a levantar limpio (restart: always).
 */
import Fastify, { type FastifyReply } from 'fastify';
import { chromium, type Browser } from 'playwright';
import { analizar, decidirPeligro, ErrorDeEnlace, type Hallazgos } from './analizar.js';
import { esDireccionInterna, type RevisorDeDirecciones } from './direcciones.js';

const TIEMPO_TOTAL_MS = 30_000; // tope de seguridad para todo el analisis

export interface OpcionesServidor {
  esInterna?: RevisorDeDirecciones; // se puede reemplazar solo en pruebas
  alCerrar?: () => void;
}

const esquemaAbrir = {
  body: {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: { url: { type: 'string', minLength: 1, maxLength: 2048 } },
  },
} as const;

export function crearServidor(opciones: OpcionesServidor = {}) {
  const esInterna = opciones.esInterna ?? esDireccionInterna;
  const alCerrar = opciones.alCerrar ?? (() => process.exit(0));

  const app = Fastify();
  let navegador: Browser | undefined;
  let ocupado = false;

  // ---------- Un solo navegador por contenedor ----------
  app.addHook('onReady', async () => {
    navegador = await chromium.launch();
  });
  app.addHook('onClose', async () => {
    await navegador?.close();
  });

  /** Cierra el proceso cuando la respuesta termino de enviarse. */
  const cerrarAlResponder = (respuesta: FastifyReply) => {
    respuesta.raw.once('finish', alCerrar);
  };

  // ---------- Endpoints ----------
  app.get('/salud', async () => ({ ok: true, ocupado }));

  app.post<{ Body: { url: string } }>('/abrir', { schema: esquemaAbrir }, async (peticion, respuesta) => {
    if (ocupado) return respuesta.code(503).send({ detail: 'Sandbox ocupado' });
    ocupado = true;
    let liberar = true;
    let temporizador: NodeJS.Timeout | undefined;

    try {
      const limite = new Promise<'congelado'>((resolver) => {
        temporizador = setTimeout(() => resolver('congelado'), TIEMPO_TOTAL_MS);
      });
      const resultado: Hallazgos | 'congelado' = await Promise.race([
        analizar(navegador!, peticion.body.url, esInterna),
        limite,
      ]);

      if (resultado === 'congelado') {
        liberar = false;
        cerrarAlResponder(respuesta);
        return respuesta.code(504).send({ detail: 'El analisis se congelo; el sandbox se reiniciara' });
      }

      decidirPeligro(resultado);
      if (resultado.peligro) {
        liberar = false; // nadie mas entra: el sandbox esta por cerrarse
        cerrarAlResponder(respuesta);
      }
      return resultado;
    } catch (error) {
      if (error instanceof ErrorDeEnlace) return respuesta.code(400).send({ detail: error.message });
      throw error;
    } finally {
      clearTimeout(temporizador);
      if (liberar) ocupado = false;
    }
  });

  return app;
}
