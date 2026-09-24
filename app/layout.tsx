import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Unterwegs · Deine Pakete',
  description: 'Deine Sendungen und ihr aktueller Versandverlauf.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
