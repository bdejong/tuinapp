import { handleApi } from './api';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/health' || path === '/api' || path.startsWith('/api/')) return handleApi(request, env);
    if (!env.ASSETS) return new Response('Static assets unavailable', { status: 503 });
    return env.ASSETS.fetch(request);
  },
};
