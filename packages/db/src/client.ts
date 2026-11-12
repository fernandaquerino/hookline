import { PrismaClient } from '@prisma/client';

export interface CreatePrismaOptions {
  databaseUrl?: string;
}

/** Creates a Prisma client. Callers own its lifecycle and must call `$disconnect()`. */
export function createPrismaClient(options: CreatePrismaOptions = {}): PrismaClient {
  return options.databaseUrl
    ? new PrismaClient({ datasources: { db: { url: options.databaseUrl } } })
    : new PrismaClient();
}
