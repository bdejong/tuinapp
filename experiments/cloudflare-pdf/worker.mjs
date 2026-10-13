import { initSync as initialize, render_calendar } from './pkg/tuinapp_pdf_wasm.js';
import module from './pkg/tuinapp_pdf_wasm_bg.wasm';
// Workers receive an already compiled WebAssembly.Module via the static import.
initialize({ module });
export default {
  async fetch(request) {
    if (request.method !== 'POST') return new Response('POST calendar JSON', {status:405});
    const input = await request.text();
    if (input.length > 2_000_000) return new Response('Calendar too large', {status:413});
    try {
      const bytes = render_calendar(input);
      return new Response(bytes, {headers:{'Content-Type':'application/pdf', 'Cache-Control':'no-store'}});
    } catch {
      return new Response('Invalid calendar data', {status:400});
    }
  }
};
