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

  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false } }, // rechaza campos extra en lugar de borrarlos
  });
  let navegador: Browser | undefined;
  let ocupado = false;
  let navegadorCaido = false;
  let cerrando = false;

  /** Deja de aceptar conexiones y termina el proceso; Docker lo levanta limpio. */
  const apagar = () => {
    if (cerrando) return;
    cerrando = true;
    app.server.close(); // nadie nuevo puede conectarse mientras se apaga
    app.server.closeAllConnections();
    alCerrar();
  };

  // ---------- Un solo navegador por contenedor ----------
  app.addHook('onReady', async () => {
    // Las senales de apagado las maneja index.ts; si Playwright las atrapa, cierra el
    // navegador pero deja vivo el proceso, y el sandbox queda inservible.
    navegador = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });

    // Si Chromium se cae (falta de memoria, una pagina que lo rompe...), el sandbox ya no
    // sirve: se cierra para que Docker lo levante limpio. Si estaba analizando, primero
    // responde (ver /abrir) y luego se cierra.
    navegador.on('disconnected', () => {
      navegadorCaido = true;
      if (!ocupado) apagar();
    });
  });
  app.addHook('onClose', async () => {
    cerrando = true; // apagado normal (docker stop): no volver a llamar a apagar()
    await navegador?.close();
  });

  /** Apaga el sandbox cuando la respuesta termino de enviarse. */
  const cerrarAlResponder = (respuesta: FastifyReply) => {
    respuesta.raw.once('finish', apagar);
  };

  // ---------- Endpoints ----------
  app.get('/salud', async () => ({ ok: true, ocupado }));

  app.post<{ Body: { url: string } }>('/abrir', { schema: esquemaAbrir }, async (peticion, respuesta) => {
    if (ocupado) return respuesta.code(503).send({ detail: 'Sandbox ocupado' });
    if (navegadorCaido || !navegador?.isConnected()) {
      cerrarAlResponder(respuesta);
      return respuesta.code(503).send({ detail: 'Sandbox sin navegador; se reiniciara' });
    }
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
      if (resultado.peligro || navegadorCaido) {
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
