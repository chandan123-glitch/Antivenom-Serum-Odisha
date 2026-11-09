import { config } from './config.js';
import { openDb } from './db.js';
import { ensureAdmin } from './auth.js';
import { createApp } from './app.js';

const db = openDb();
ensureAdmin(db);
const server = createApp(db).listen(config.port, () => {
  console.log(`ASV Odisha API listening on http://localhost:${config.port}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
