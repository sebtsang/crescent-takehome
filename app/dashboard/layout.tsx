import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/donors', label: 'Donors' },
  { href: '/dashboard/assistant', label: 'Assistant' },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-[var(--surface-raised)]">
        <div className="mx-auto flex max-w-shell items-center gap-7 px-6 py-3 md:px-10">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-3.5 w-3.5 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 32% 32%, var(--accent) 55%, transparent 56%), var(--purple-100)',
              }}
            />
            <span className="display text-[0.95rem] text-txt">Crescent</span>
          </Link>
          <nav className="flex items-center gap-4">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-txt3 transition-colors hover:text-txt"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-shell px-6 py-6 md:px-10">{children}</main>
    </div>
  );
}
