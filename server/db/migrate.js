require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./index');

async function main() {
  if (!db.isConfigured()) throw new Error('DATABASE_URL is not configured.');
  const dir = __dirname;
  const files = fs.readdirSync(dir).filter((name) => /^\d+.*\.sql$/i.test(name)).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`[db:migrate] applying ${file}`);
    await db.query(sql);
  }
  console.log('[db:migrate] complete');
  await db.getPool().end();
}

main().catch((err) => {
  console.error('[db:migrate]', err);
  process.exitCode = 1;
});
