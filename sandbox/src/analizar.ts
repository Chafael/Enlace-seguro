/**
 * Analisis de un enlace: lo abre en una sesion desechable simulando un celular,
 * observa lo que hace la pagina y toma la captura.
 */
import { devices, errors, type Browser } from 'playwright';
import type { RevisorDeDirecciones } from './direcciones.js';

const TIEMPO_LIMITE_MS = 20_000;  // maximo para cargar la pagina
const ESPERA_SCRIPTS_MS = 1_500;  // tiempo extra para que corran los scripts de la pagina
const CELULAR = devices['Pixel 7'];

export interface Hallazgos {
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
  capturaPngBase64: string | null;
  peligro: boolean;
  motivos: string[];
}

/** Error del enlace recibido; se responde con 400 sin abrir nada. */
export class ErrorDeEnlace extends Error {}

const primeraLinea = (error: unknown) => String(error instanceof Error ? error.message : error).split('\n')[0].slice(0, 150);

export async function analizar(
  navegador: Browser,
  url: string,
  esInterna: RevisorDeDirecciones,
): Promise<Hallazgos> {
  // ---------- Validacion antes de abrir el navegador ----------
  let enlace: URL;
  try {
    enlace = new URL(url);
  } catch {
    throw new ErrorDeEnlace('El enlace no es valido');
  }
  if (!['http:', 'https:'].includes(enlace.protocol)) {
    throw new ErrorDeEnlace('Solo se aceptan enlaces http o https');
  }
  if (await esInterna(enlace.hostname)) {
    throw new ErrorDeEnlace('No se permiten direcciones internas');
  }

  const hallazgos: Hallazgos = {
    urlInicial: url,
    urlFinal: null,
    redirecciones: [],
    titulo: '',
    formulariosPassword: 0,
    descargaIntentada: false,
    archivoDescarga: null,
    peticionesBloqueadas: [],
    tiempoExcedido: false,
    navegadorFallo: false,
    errores: [],
    capturaPngBase64: null,
    peligro: false,
    motivos: [],
  };

  // ---------- Sesion desechable ----------
  const contexto = await navegador.newContext({
    ...CELULAR,
    acceptDownloads: false,   // nunca se guarda un archivo
    serviceWorkers: 'block',  // la pagina no puede quedarse corriendo en segundo plano
  });

  try {
    // ---------- Vigilantes ----------
    await contexto.route('**/*', async (ruta) => {
      const destino = new URL(ruta.request().url());
      if (['http:', 'https:'].includes(destino.protocol) && (await esInterna(destino.hostname))) {
        hallazgos.peticionesBloqueadas.push(destino.href.slice(0, 200));
        return ruta.abort('blockedbyclient');
      }
      return ruta.continue();
    });

    await contexto.routeWebSocket(/.*/, async (socket) => {
      if (await esInterna(new URL(socket.url()).hostname)) {
        hallazgos.peticionesBloqueadas.push(socket.url().slice(0, 200));
        return socket.close();
      }
      socket.connectToServer();
    });

    const pagina = await contexto.newPage();

    pagina.on('download', (descarga) => {
      hallazgos.descargaIntentada = true;
      hallazgos.archivoDescarga = descarga.suggestedFilename();
    });

    pagina.on('request', (peticion) => {
      if (peticion.isNavigationRequest() && peticion.frame() === pagina.mainFrame()) {
        if (hallazgos.redirecciones.at(-1) !== peticion.url()) hallazgos.redirecciones.push(peticion.url());
      }
    });

    // ---------- Abrir la pagina ----------
    try {
      await pagina.goto(url, { waitUntil: 'load', timeout: TIEMPO_LIMITE_MS });
      await pagina.waitForTimeout(ESPERA_SCRIPTS_MS);
    } catch (error) {
      if (error instanceof errors.TimeoutError) {
        hallazgos.tiempoExcedido = true;
      } else if (primeraLinea(error).includes('Download is starting')) {
        hallazgos.descargaIntentada = true;
      } else {
        hallazgos.errores.push(`No se pudo abrir la pagina: ${primeraLinea(error)}`);
      }
    }

    // ---------- Lo que se ve al final ----------
    hallazgos.urlFinal = pagina.url();
    try {
      hallazgos.titulo = await pagina.title();
      hallazgos.formulariosPassword = await pagina.locator('input[type=password]').count();
      const captura = await pagina.screenshot({ timeout: 5_000 });
      hallazgos.capturaPngBase64 = captura.toString('base64');
    } catch (error) {
      hallazgos.errores.push(`No se pudo tomar la captura: ${primeraLinea(error)}`);
    }
  } finally {
    // Se borran cookies, almacenamiento y pestanas. Si el navegador murio, cerrar falla: se ignora.
    await contexto.close().catch(() => undefined);
  }

  hallazgos.navegadorFallo = !navegador.isConnected();
  return hallazgos;
}

/** Marca peligro si la pagina hizo algo que justifica cerrar el sandbox. */
export function decidirPeligro(hallazgos: Hallazgos): void {
  const motivos: string[] = [];
  if (hallazgos.descargaIntentada) motivos.push('La pagina intento descargar un archivo');
  if (hallazgos.peticionesBloqueadas.length > 0) motivos.push('La pagina intento conectarse a direcciones internas');
  if (hallazgos.tiempoExcedido) motivos.push('La pagina excedio el tiempo limite');
  if (hallazgos.navegadorFallo) motivos.push('La pagina hizo fallar el navegador del sandbox');
  hallazgos.peligro = motivos.length > 0;
  hallazgos.motivos = motivos;
}
