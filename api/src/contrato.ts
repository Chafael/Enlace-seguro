/**
 * Contrato entre la integracion (Carlos Rafael) y el analisis (Arturo).
 *
 * La integracion abre el enlace en un sandbox y despues llama a:
 *   revisarFuentes(urls)               -> fuentes.ts   (Arturo)
 *   calcularVeredicto(fuentes, sandbox) -> veredicto.ts (Arturo)
 *
 * Mientras ninguno cambie estos tipos, cada quien puede trabajar sin
 * romper el codigo del otro.
 */

/** Lo que reporta el sandbox (igual a la respuesta de POST /abrir, sin la captura). */
export interface HallazgosSandbox {
  urlInicial: string;
  urlFinal: string | null;
  redirecciones: string[];
  titulo: string;
  formulariosPassword: number;
  descargaIntentada: boolean;
  archivoDescarga: string | null;
  peticionesBloqueadas: string[];
  tiempoExcedido: boolean;
  navegadorFallo: boolean;
  errores: string[];
  peligro: boolean;
  motivos: string[];
}

/**
 * Resultado de mandar el enlace a un sandbox.
 * - ok:            el sandbox abrio la pagina; ver hallazgos.
 * - fallo:         el sandbox se cayo o se congelo con esta pagina (sospechoso por si mismo).
 * - rechazado:     el sandbox se nego a abrirlo (por ejemplo, una direccion interna).
 * - no-disponible: ningun sandbox respondio a tiempo.
 */
export interface ResultadoSandbox {
  estado: 'ok' | 'fallo' | 'rechazado' | 'no-disponible';
  hallazgos: HallazgosSandbox | null;
  captura: string | null; // PNG en base64
  detalle?: string;
}

/** Resultado de una fuente de amenazas (VirusTotal, Google Safe Browsing, URLhaus...). */
export interface ConsultaFuente {
  fuente: string;
  consultada: boolean; // false si la fuente fallo o no hay llave
  malicioso: boolean;
  detalle: string; // en lenguaje sencillo, se puede mostrar al usuario
}

export interface ResultadoFuentes {
  consultas: ConsultaFuente[];
  edadDominioDias: number | null; // null si no se pudo consultar
}

export type Veredicto = 'seguro' | 'sospechoso' | 'peligroso';

export interface Decision {
  veredicto: Veredicto;
  razones: string[]; // en lenguaje sencillo, se muestran en la app
}
