/**
 * Cliente de los 3 sandboxes: manda cada enlace a uno libre.
 */
import http from 'node:http';
import type { HallazgosSandbox, ResultadoSandbox } from './contrato.js';

// Errores que significan "este sandbox no esta encendido ahorita" (se esta reiniciando).
const NO_ENCENDIDO = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH']);

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

export interface OpcionesCliente {
  esperaMaximaMs: number; // cuanto esperar a que algun sandbox quede libre
  tiempoAnalisisMs: number; // cuanto esperar la respuesta de un sandbox
}

type Intento = ResultadoSandbox | 'no-libre' | 'conexion-cortada';

export class ClienteSandboxes {
  private siguiente = 0;

  constructor(
    private readonly direcciones: string[],
    private readonly opciones: OpcionesCliente = { esperaMaximaMs: 60_000, tiempoAnalisisMs: 45_000 },
  ) {
    if (direcciones.length === 0) throw new Error('No hay sandboxes configurados');
  }

  /** Busca un sandbox libre, empezando por el siguiente en turno, y le manda el enlace. */
  async analizar(url: string): Promise<ResultadoSandbox> {
    const limite = Date.now() + this.opciones.esperaMaximaMs;
    const cortaron = new Set<number>(); // sandboxes que cortaron la conexion con este enlace

    while (Date.now() < limite) {
      const inicio = this.siguiente; // turno fijo durante esta vuelta
      for (let intento = 0; intento < this.direcciones.length; intento++) {
        const indice = (inicio + intento) % this.direcciones.length;
        if (cortaron.has(indice)) continue;

        const resultado = await this.intentar(this.direcciones.at(indice)!, url);
        if (resultado === 'no-libre') continue;

        this.siguiente = (indice + 1) % this.direcciones.length;
        if (resultado === 'conexion-cortada') {
          // Un corte puede ser casualidad (el sandbox se estaba reiniciando): se intenta una vez
          // en otro. Dos cortes con el mismo enlace: la pagina tumba los sandboxes.
          cortaron.add(indice);
          if (cortaron.size >= 2 || cortaron.size === this.direcciones.length) {
            return { estado: 'fallo', hallazgos: null, captura: null, detalle: 'La pagina hizo fallar el sandbox' };
          }
          continue;
        }
        return resultado;
      }
      await dormir(1_000); // todos ocupados o reiniciandose: esperar y volver a intentar
    }

    return {
      estado: 'no-disponible',
      hallazgos: null,
      captura: null,
      detalle: 'Ningun sandbox estuvo disponible; intenta de nuevo en unos minutos',
    };
  }

  private async intentar(base: string, url: string): Promise<Intento> {
    let respuesta: { status: number; texto: string };
    try {
      respuesta = await enviar(base, JSON.stringify({ url }), this.opciones.tiempoAnalisisMs);
    } catch (error) {
      const codigo = (error as NodeJS.ErrnoException).code;
      if (codigo && NO_ENCENDIDO.has(codigo)) return 'no-libre';
      if (codigo === 'TIEMPO_AGOTADO') {
        return { estado: 'fallo', hallazgos: null, captura: null, detalle: 'La pagina congelo el sandbox' };
      }
      return 'conexion-cortada';
    }

    // 503: ocupado o reiniciandose. 500: el sandbox tiene un problema propio (no de la pagina).
    // En ambos casos se prueba con otro sandbox.
    if (respuesta.status === 503 || respuesta.status === 500) return 'no-libre';

    let cuerpo: Record<string, unknown> = {};
    try {
      cuerpo = JSON.parse(respuesta.texto);
    } catch {
      // cuerpo vacio o roto: se maneja abajo por el codigo de estado
    }

    if (respuesta.status === 200) {
      const { capturaPngBase64, ...hallazgos } = cuerpo;
      return {
        estado: 'ok',
        hallazgos: hallazgos as unknown as HallazgosSandbox,
        captura: typeof capturaPngBase64 === 'string' ? capturaPngBase64 : null,
      };
    }
    if (respuesta.status === 400) {
      return { estado: 'rechazado', hallazgos: null, captura: null, detalle: String(cuerpo.detail ?? 'Enlace rechazado') };
    }
    if (respuesta.status === 504) {
      return { estado: 'fallo', hallazgos: null, captura: null, detalle: 'La pagina congelo el sandbox' };
    }
    return { estado: 'fallo', hallazgos: null, captura: null, detalle: `El sandbox respondio con error ${respuesta.status}` };
  }
}

/**
 * POST a un sandbox con una conexion nueva que se cierra al terminar (agent: false).
 * No se reutilizan conexiones: un sandbox que se cerro despues de responder
 * nunca recibe por error el siguiente enlace.
 */
function enviar(base: string, cuerpo: string, tiempoMs: number): Promise<{ status: number; texto: string }> {
  return new Promise((resolver, rechazar) => {
    const peticion = http.request(
      new URL('/abrir', base),
      {
        method: 'POST',
        agent: false,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(cuerpo) },
      },
      (respuesta) => {
        const partes: Buffer[] = [];
        respuesta.on('data', (parte: Buffer) => partes.push(parte));
        respuesta.on('end', () => {
          clearTimeout(temporizador);
          resolver({ status: respuesta.statusCode ?? 0, texto: Buffer.concat(partes).toString('utf8') });
        });
        respuesta.on('error', rechazar);
      },
    );
    const temporizador = setTimeout(() => {
      peticion.destroy(Object.assign(new Error('Tiempo agotado'), { code: 'TIEMPO_AGOTADO' }));
    }, tiempoMs);
    peticion.on('error', (error) => {
      clearTimeout(temporizador);
      rechazar(error);
    });
    peticion.end(cuerpo);
  });
}
