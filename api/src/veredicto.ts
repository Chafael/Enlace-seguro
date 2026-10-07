/**
 * Calculo del veredicto. VERSION PROVISIONAL: Arturo la completa en la semana 3
 * con sus reglas propias (marca imitada, terminaciones .xyz, IP en lugar de
 * dominio, sin HTTPS...). Esta version ya sigue las reglas de la propuesta:
 *   Peligroso:  una fuente lo reporta, o el sandbox detecto peligro o fallo.
 *   Sospechoso: sin reportes, pero con senales de riesgo.
 *   Seguro:     sin reportes ni senales.
 */
import type { Decision, ResultadoFuentes, ResultadoSandbox } from './contrato.js';

const DIAS_DOMINIO_NUEVO = 30;

export function calcularVeredicto(fuentes: ResultadoFuentes, sandbox: ResultadoSandbox): Decision {
  // ---------- Peligroso ----------
  const reportes = fuentes.consultas.filter((consulta) => consulta.malicioso);
  if (reportes.length > 0) {
    return { veredicto: 'peligroso', razones: reportes.map((r) => `${r.fuente}: ${r.detalle}`) };
  }
  if (sandbox.estado === 'fallo') {
    return { veredicto: 'peligroso', razones: [sandbox.detalle ?? 'La pagina hizo fallar el sandbox'] };
  }
  if (sandbox.hallazgos?.peligro) {
    return { veredicto: 'peligroso', razones: sandbox.hallazgos.motivos };
  }

  // ---------- Sospechoso ----------
  const razones: string[] = [];
  if (sandbox.estado === 'rechazado') {
    razones.push(`No se abrio el enlace: ${sandbox.detalle ?? 'direccion no permitida'}`);
  }
  if (sandbox.hallazgos && sandbox.hallazgos.formulariosPassword > 0) {
    razones.push('La pagina pide una contrasena: confirma que sea el sitio oficial antes de escribirla');
  }
  if (fuentes.edadDominioDias !== null && fuentes.edadDominioDias < DIAS_DOMINIO_NUEVO) {
    razones.push(`El dominio se registro hace ${fuentes.edadDominioDias} dias; los sitios de estafa suelen ser nuevos`);
  }
  if (razones.length > 0) return { veredicto: 'sospechoso', razones };

  // ---------- Seguro ----------
  return {
    veredicto: 'seguro',
    razones: ['No se detectaron amenazas. Ningun analisis garantiza el 100%: si dudas, no escribas tus datos.'],
  };
}
