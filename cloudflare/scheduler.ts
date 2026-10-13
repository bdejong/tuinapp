import type { Env } from './types';

export { BackupRunner } from './backup-runner';

interface SchedulerEnv extends Env {
  BACKUP_RUNNER: DurableObjectNamespace;
}

export default {
  async scheduled(_event: ScheduledController, env: SchedulerEnv): Promise<void> {
    const runner = env.BACKUP_RUNNER.getByName('daily-backup');
    const response = await runner.fetch('https://backup-runner.internal/run', { method: 'POST' });
    if (!response.ok) throw new Error('Scheduled backup runner failed');
  },
};
