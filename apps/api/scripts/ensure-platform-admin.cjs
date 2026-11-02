const path = require('node:path');
process.loadEnvFile(path.resolve(__dirname, '../.env'));
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const db = new PrismaClient();
(async () => {
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!password || password.length < 8) throw new Error('Set PLATFORM_ADMIN_PASSWORD to a value of at least 8 characters.');
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await db.user.upsert({
    where: { email: 'owner@syncup.local' },
    create: { email: 'owner@syncup.local', displayName: 'Platform Administrator', passwordHash, status: 'ACTIVE', isPlatformAdmin: true },
    update: { displayName: 'Platform Administrator', passwordHash, status: 'ACTIVE', isPlatformAdmin: true }
  });
  console.log(JSON.stringify({ email: user.email, status: user.status, isPlatformAdmin: user.isPlatformAdmin }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
