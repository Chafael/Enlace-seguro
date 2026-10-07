/**
 * Prueba minima de la semana 1.
 * Abre un enlace simulando un celular y guarda la captura en captura.png.
 * Uso:  npm run prueba -- https://example.com
 */
import { chromium, devices } from 'playwright';

const url = process.argv[2] ?? 'https://example.com';

const navegador = await chromium.launch();
const contexto = await navegador.newContext({ ...devices['Pixel 7'] });
const pagina = await contexto.newPage();

await pagina.goto(url, { timeout: 20_000 });
console.log('Titulo:', await pagina.title());
console.log('Direccion final:', pagina.url());

await pagina.screenshot({ path: 'captura.png' });
console.log('Captura guardada en captura.png');

await contexto.close();
await navegador.close();
