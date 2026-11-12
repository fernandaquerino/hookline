import { hashPassword } from '../auth/password';

/** Usage: pnpm --filter @hookline/api hash-password '<password>' */
async function main(): Promise<void> {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: pnpm --filter @hookline/api hash-password '<password>'");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Use a password of at least 8 characters.');
    process.exit(1);
  }
  console.log(await hashPassword(password));
}

void main();
