import { createPrismaClient } from '../client';
import { parseEncryptionKey } from '../secret-box';
import { seed } from './seed';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    await seed(prisma, parseEncryptionKey(process.env.HOOKLINE_ENCRYPTION_KEY));
    console.log('Seeded demo endpoints.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
