/**
 * El propio origen de la app (PUBLIC_URL) debe estar SIEMPRE permitido.
 *
 * Regresión real: Vite emite sus tags con el atributo `crossorigin`
 * (<script type="module" crossorigin>, <link rel="stylesheet" crossorigin>),
 * y ese atributo hace que el navegador mande cabecera Origin incluso en
 * peticiones same-origin. Como la lista de orígenes permitidos no incluía el
 * origen propio, el navegador recibía 403 (application/json) al pedir
 * /admin/assets/*.css y *.js, y el backoffice quedaba en pantalla en blanco
 * — en local y también en el VPS, donde la SPA se sirve desde el mismo
 * origen que la API. curl no lo detectaba porque no manda Origin.
 */
import type { CorsOptions } from 'cors';

type OriginCallback = (err: Error | null, allow?: boolean) => void;
type OriginFn = (origin: string | undefined, callback: OriginCallback) => void;

/**
 * cors.config.ts calcula la lista de orígenes permitidos UNA vez, al
 * importarse (`const allowedOrigins = getAllowedOrigins()`), así que cada
 * caso necesita resetear el módulo con el entorno ya puesto.
 */
const loadCorsOptions = (env: Record<string, string | undefined>): CorsOptions => {
  jest.resetModules();
  const previous = { ...process.env };
  Object.assign(process.env, env);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { corsOptions } = require('../../src/config/cors.config') as {
    corsOptions: CorsOptions;
  };

  process.env = previous;
  return corsOptions;
};

const isOriginAllowed = (options: CorsOptions, origin: string): boolean => {
  const originOption = options.origin as OriginFn | undefined;
  if (typeof originOption !== 'function') {
    throw new Error('corsOptions.origin debería ser una función');
  }

  let allowed = false;
  originOption(origin, (err, allow) => {
    allowed = !err && allow === true;
  });
  return allowed;
};

describe('cors.config — origen propio (PUBLIC_URL)', () => {
  it('permite el origen propio en producción, donde no hay defaults de localhost', () => {
    const options = loadCorsOptions({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://facturacion.deckasoft.com',
      ALLOWED_ORIGINS: undefined,
    });

    expect(isOriginAllowed(options, 'https://facturacion.deckasoft.com')).toBe(true);
  });

  it('sigue bloqueando un origen ajeno cuando solo está permitido el propio', () => {
    const options = loadCorsOptions({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://facturacion.deckasoft.com',
      ALLOWED_ORIGINS: undefined,
    });

    expect(isOriginAllowed(options, 'https://evil.example.com')).toBe(false);
  });

  it('usa solo el origen de PUBLIC_URL, ignorando su path', () => {
    const options = loadCorsOptions({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://facturacion.deckasoft.com/admin',
      ALLOWED_ORIGINS: undefined,
    });

    expect(isOriginAllowed(options, 'https://facturacion.deckasoft.com')).toBe(true);
  });

  it('distingue el puerto: otro puerto del mismo host no es el origen propio', () => {
    const options = loadCorsOptions({
      NODE_ENV: 'production',
      PUBLIC_URL: 'http://localhost:3000',
      ALLOWED_ORIGINS: undefined,
    });

    expect(isOriginAllowed(options, 'http://localhost:3000')).toBe(true);
    expect(isOriginAllowed(options, 'http://localhost:9999')).toBe(false);
  });

  it('mantiene los orígenes de ALLOWED_ORIGINS junto al propio', () => {
    const options = loadCorsOptions({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://facturacion.deckasoft.com',
      ALLOWED_ORIGINS: 'https://app.cliente.com, https://otro.cliente.com',
    });

    expect(isOriginAllowed(options, 'https://facturacion.deckasoft.com')).toBe(true);
    expect(isOriginAllowed(options, 'https://app.cliente.com')).toBe(true);
    expect(isOriginAllowed(options, 'https://otro.cliente.com')).toBe(true);
    expect(isOriginAllowed(options, 'https://no-listado.com')).toBe(false);
  });

  it('no rompe si PUBLIC_URL no es una URL válida (loadEnv ya aborta antes en runtime)', () => {
    expect(() =>
      loadCorsOptions({
        NODE_ENV: 'production',
        PUBLIC_URL: 'no-es-una-url',
        ALLOWED_ORIGINS: undefined,
      }),
    ).not.toThrow();
  });

  it('permite X-API-Key en el preflight: es la credencial primaria de tenant', () => {
    const options = loadCorsOptions({
      NODE_ENV: 'production',
      PUBLIC_URL: 'https://facturacion.deckasoft.com',
      ALLOWED_ORIGINS: undefined,
    });

    expect(options.allowedHeaders).toContain('X-API-Key');
  });
});
