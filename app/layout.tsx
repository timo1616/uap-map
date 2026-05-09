import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PURSUE // Declassified UAP Map',
  description: 'Interactive map of 128 declassified US government UAP/UFO sightings. Source: US DoD PURSUE program.',
  openGraph: {
    title: 'PURSUE // Declassified UAP Map',
    description: 'Interactive map of 128 declassified US government UAP/UFO sightings. Source: US DoD PURSUE program.',
    url: 'https://uap-map.vercel.app',
    siteName: 'PURSUE UAP Map',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PURSUE // Declassified UAP Map',
    description: 'Interactive map of 128 declassified US government UAP/UFO sightings. Source: US DoD PURSUE program.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
