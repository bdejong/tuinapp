import { scheduledBackup } from './backups';
import type { Env } from './types';

export default {
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Await the upload so a failure is visible in the scheduled invocation logs.
    await scheduledBackup(env);
  },
};
