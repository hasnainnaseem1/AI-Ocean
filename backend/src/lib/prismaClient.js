const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

// Prisma 7 dropped the built-in engine's connection-string handling in
// favour of driver adapters. This is the one place the Postgres connection is
// actually opened, and the only module that should construct a client.
const adapter = new PrismaPg(process.env.DATABASE_URL);

const prisma = new PrismaClient({ adapter });

module.exports = prisma;
