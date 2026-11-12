// Creates the E2E database if needed, applies migrations and empties it.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@hookline/db');

export async function prepareDatabase(databaseUrl) {
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!name.endsWith('_e2e')) throw new Error(`Refusing to reset "${name}": name must end in _e2e`);

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const exists = await admin.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (exists.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.$disconnect();
  }

  const dbPackage = path.dirname(require.resolve('@hookline/db/package.json'));
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [dbPackage] });
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "DeliveryAttempt", "Delivery", "InboundRequest", "Destination", "Endpoint", "OutboxEvent" CASCADE',
    );
  } finally {
    await prisma.$disconnect();
  }
}
