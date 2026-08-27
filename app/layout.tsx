import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ConvexClientProvider } from '@/components/convex-client-provider';
import './globals.css';

// Crescent's site uses TWK Lausanne, which is commercial. Inter is the closest
// free grotesque; the tightened tracking in globals.css does the rest.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

// Crescent's own choice for code and tabular figures.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
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
