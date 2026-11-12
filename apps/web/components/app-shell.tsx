'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { post } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Endpoints' },
  { href: '/dead-letters', label: 'Dead letters' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    window.location.assign('/login');
  };
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⤳
          </span>
          Hookline
        </Link>
        <nav aria-label="Main">
          {NAV.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/' ||
                  pathname.startsWith('/endpoints') ||
                  pathname.startsWith('/requests')
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? 'active' : undefined}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button type="button" className="button ghost small" onClick={() => void logout()}>
          Sign out
        </button>
      </header>
      <main className="content">{children}</main>
      <footer className="footer muted">
        For development and test traffic only. Do not send production personal data.
      </footer>
    </div>
  );
}
