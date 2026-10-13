import { DurableObject } from 'cloudflare:workers';
import { scheduledBackup } from './backups';
import type { Env } from './types';

/** Private cron entrypoint. All backup state and safety checks remain in scheduledBackup. */
export class BackupRunner extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/run') return new Response(null, { status: 404 });
    try {
      await scheduledBackup(this.env);
      return new Response(null, { status: 204 });
    } catch {
      // Keep garden data and provider error details out of the internal response.
      return new Response(null, { status: 500 });
    }
  }
}
