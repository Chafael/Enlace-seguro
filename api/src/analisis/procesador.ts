/**
 * Procesador de la fila: toma los analisis pendientes de la base de datos,
 * los manda a los sandboxes y guarda el veredicto.
 * Corre tantos trabajadores como sandboxes hay.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { BaseDeDatos } from '../db.js';
import type { ResultadoFuentes } from './contrato.js';
import { revisarFuentes } from './fuentes.js';
import type { ClienteSandboxes } from './sandboxes.js';
import { calcularVeredicto } from './veredicto.js';

const ESPERA_SIN_TRABAJO_MS = 2_000;

export interface Procesador {
  avisar(): void; // hay un analisis nuevo: despertar a los trabajadores
  detener(): Promise<void>;
}

export async function iniciarProcesador(
  db: BaseDeDatos,
  sandboxes: ClienteSandboxes,
  trabajadores: number,
  log: FastifyBaseLogger,
): Promise<Procesador> {
  let activo = true;
  let despertadores: Array<() => void> = [];

  // Espera hasta que pase el tiempo o hasta que llegue un aviso, lo que ocurra primero.
  const esperar = (ms: number) =>
    new Promise<void>((resolver) => {
      const temporizador = setTimeout(resolver, ms);
      despertadores.push(() => {
        clearTimeout(temporizador);
        resolver();
      });
    });

  const avisar = () => {
    const pendientes = despertadores;
    despertadores = [];
    pendientes.forEach((despertar) => despertar());
  };

  // ---------- Recuperacion: lo que quedo a medias si la API se apago ----------
  const { rowCount } = await db.query(
    "UPDATE analisis SET estado = 'pendiente', actualizado_en = now() WHERE estado = 'procesando'",
  );
  if (rowCount) log.warn(`${rowCount} analisis interrumpidos regresaron a la fila`);

  // ---------- Tomar el siguiente de la fila ----------
  async function tomarSiguiente() {
    const { rows } = await db.query<{ id: string; url: string }>(`
      UPDATE analisis SET estado = 'procesando', actualizado_en = now()
      WHERE id = (
        SELECT id FROM analisis
        WHERE estado = 'pendiente'
        ORDER BY creado_en
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, url`);
    return rows[0];
  }

  // ---------- Procesar uno ----------
  async function procesar(id: string, url: string) {
    const sandbox = await sandboxes.analizar(url);

    if (sandbox.estado === 'no-disponible') {
      await db.query(
        "UPDATE analisis SET estado = 'error', resultado = $2, actualizado_en = now() WHERE id = $1",
        [id, { detalle: sandbox.detalle }],
      );
      return;
    }

    // Se revisan en las fuentes el enlace inicial, cada salto y el final, sin repetir.
    const vistos = [url, ...(sandbox.hallazgos?.redirecciones ?? []), sandbox.hallazgos?.urlFinal];
    const urls = [...new Set(vistos.filter((u): u is string => !!u && /^https?:\/\//i.test(u)))];

    let fuentes: ResultadoFuentes = { consultas: [], edadDominioDias: null };
    try {
      fuentes = await revisarFuentes(urls);
    } catch (error) {
      log.error({ err: error, id }, 'Fallo la revision de fuentes; se sigue solo con el sandbox');
    }

    const decision = calcularVeredicto(fuentes, sandbox);
    const resultado = {
      razones: decision.razones,
      urlFinal: sandbox.hallazgos?.urlFinal ?? null,
      sandbox: { estado: sandbox.estado, detalle: sandbox.detalle ?? null, hallazgos: sandbox.hallazgos },
      fuentes,
    };

    await db.query(
      `UPDATE analisis
       SET estado = 'terminado', veredicto = $2, resultado = $3, captura = $4, actualizado_en = now()
       WHERE id = $1`,
      [id, decision.veredicto, resultado, sandbox.captura],
    );
  }

  // ---------- Bucle de cada trabajador ----------
  async function trabajar(numero: number) {
    while (activo) {
      let fila: { id: string; url: string } | undefined;
      try {
        fila = await tomarSiguiente();
      } catch (error) {
        log.error({ err: error, trabajador: numero }, 'No se pudo leer la fila');
        await esperar(ESPERA_SIN_TRABAJO_MS);
        continue;
      }
      if (!fila) {
        await esperar(ESPERA_SIN_TRABAJO_MS);
        continue;
      }

      try {
        await procesar(fila.id, fila.url);
      } catch (error) {
        log.error({ err: error, id: fila.id }, 'Fallo el analisis');
        await db
          .query("UPDATE analisis SET estado = 'error', resultado = $2, actualizado_en = now() WHERE id = $1", [
            fila.id,
            { detalle: 'Error interno al analizar' },
          ])
          .catch(() => undefined);
      }
    }
  }

  const bucles = Array.from({ length: trabajadores }, (_, i) => trabajar(i + 1));

  return {
    avisar,
    async detener() {
      activo = false;
      avisar();
      await Promise.allSettled(bucles);
    },
  };
}
