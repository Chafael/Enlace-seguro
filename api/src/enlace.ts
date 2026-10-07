/**
 * Saca el enlace de lo que pego el usuario: puede ser solo el enlace o el
 * mensaje completo ("Tu paquete esta retenido, entra a bit.ly/abc").
 * El texto del mensaje nunca se guarda; solo el enlace.
 */
const CON_ESQUEMA = /\bhttps?:\/\/[^\s<>"'`]+/i;
// (?<!...): no toma dominios que vienen despues de @ (correos), de :// (otros esquemas
// como ftp) ni a la mitad de una palabra.
const SIN_ESQUEMA = /(?<![@\w./:-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{2,5})?(?:\/[^\s<>"'`]*)?/i;
const PUNTUACION_FINAL = /[.,;:!?)\]}]+$/;
const LARGO_MAXIMO = 2048;

export function extraerEnlace(texto: string): string | null {
  const encontrado = texto.match(CON_ESQUEMA)?.[0] ?? texto.match(SIN_ESQUEMA)?.[0];
  if (!encontrado) return null;

  let candidato = encontrado.replace(PUNTUACION_FINAL, '');
  if (!/^https?:\/\//i.test(candidato)) candidato = `https://${candidato}`;

  try {
    const enlace = new URL(candidato);
    if (!['http:', 'https:'].includes(enlace.protocol) || !enlace.hostname) return null;
    if (enlace.username || enlace.password) return null; // https://usuario:clave@sitio: truco de phishing
    enlace.hash = ''; // lo que va despues de # no cambia la pagina que se abre
    const normalizado = enlace.href;
    return normalizado.length <= LARGO_MAXIMO ? normalizado : null;
  } catch {
    return null;
  }
}
