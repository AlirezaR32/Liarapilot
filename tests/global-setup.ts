import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export default function globalSetup(): void {
  const dbPath = path.resolve(__dirname, '..', 'db', 'test.db');
  try {
    fs.rmSync(dbPath, { force: true });
  } catch {
    // best effort
  }
  process.env.DATABASE_URL = `file:${dbPath}`;
  execSync(`bunx prisma db push --accept-data-loss --skip-generate`, {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
    cwd: path.resolve(__dirname, '..'),
  });
  console.log(`[test-setup] schema pushed to ${dbPath}`);
}
