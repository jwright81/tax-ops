import { createApp } from './app/createApp.js';
import { ensureBootstrapAdmin } from './auth/bootstrap.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { ensureDefaultSettings } from './modules/settings.js';

async function main() {
  await runMigrations();
  await ensureDefaultSettings();

  const bootstrap = await ensureBootstrapAdmin();
  if (bootstrap.created) {
    console.log(`bootstrap admin created: ${bootstrap.username}`);
  }

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`tax-ops server listening on :${env.PORT}`);
  });
}

main().catch((error) => {
  console.error('fatal server startup error', error);
  process.exit(1);
});
