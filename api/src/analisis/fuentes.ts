/**
 * Fuentes de amenazas. VERSION PROVISIONAL: Arturo la reemplaza en la semana 3.
 *
 * Recibe el enlace inicial, las redirecciones y el enlace final que observo el
 * sandbox (sin repetir). Debe consultarlos en VirusTotal, Google Safe Browsing y
 * URLhaus, y la edad del dominio por RDAP.
 *
 * Reglas para la version real:
 * - Solo se llama a las fuentes externas; nunca se abre el enlace desde la API
 *   (eso ya lo hizo el sandbox). Asi la API no corre riesgo de SSRF.
 * - Si una fuente falla o no hay llave, se regresa consultada: false; nunca
 *   se lanza un error que detenga el analisis.
 * - Las llaves se leen de process.env, nunca se escriben en el codigo.
 */
import type { ResultadoFuentes } from './contrato.js';

export async function revisarFuentes(urls: string[]): Promise<ResultadoFuentes> {
  void urls;
  return { consultas: [], edadDominioDias: null };
}
