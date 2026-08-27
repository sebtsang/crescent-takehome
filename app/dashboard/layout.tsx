import Link from 'next/link';
import { CrescentWordmark } from '@/components/ui/crescent-wordmark';
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
          <Link href="/dashboard" aria-label="Crescent" className="shrink-0">
            <CrescentWordmark className="h-[18px] w-[98px] text-txt" />
          </Link>
          <nav className="flex items-center gap-4">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[0.8125rem] font-normal text-txt2 transition-colors hover:text-txt"
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
