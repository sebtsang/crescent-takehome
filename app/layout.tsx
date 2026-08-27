import type { Metadata } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import { ConvexClientProvider } from '@/components/convex-client-provider';
import './globals.css';

// Crescent's site uses TWK Lausanne, which is commercial. Inter is the closest
// free grotesque; the tightened tracking in globals.css does the rest.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

// Crescent's display face, used sparingly — page titles and the headline figure.
const display = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
  display: 'swap',
});

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
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
