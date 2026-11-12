import type { PrismaClient } from '@hookline/db';

/** Refuses to run destructive test helpers against anything but a *_test database. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to use database "${name}" for tests: its name must end in _test`);
  }
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "DeliveryAttempt", "Delivery", "InboundRequest", "Destination", "Endpoint", "OutboxEvent" CASCADE',
  );
}
