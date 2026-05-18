import type { MiddlewareHandler } from 'astro';

const COOP_COEP: MiddlewareHandler = async ({ locals }, next) => {
  const response = await next();
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return response;
};

export const onRequest = COOP_COEP;
