import { PrismaClient } from '@prisma/client'

/**
 * Singleton Prisma client.
 *
 * Next.js hot-reloads modules in dev, and each API route used to instantiate
 * its own PrismaClient — that leaks connections fast. Stashing the client on
 * `globalThis` keeps exactly one instance alive across reloads and routes.
 */
const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

export const prisma: PrismaClient = globalForPrisma.__prisma ?? (globalForPrisma.__prisma = new PrismaClient())
