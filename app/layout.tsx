import type { Metadata } from 'next';
import { Inter, Space_Mono } from 'next/font/google';
import { ConvexClientProvider } from '@/components/convex-client-provider';
import './globals.css';

// Substitute for the style guide's "Cursor Gothic", which is not public.
const sans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

// The guide's own choice for code and tabular figures.
const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Crescent — Fundraising',
  description: 'Fundraising reporting and assistant.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
