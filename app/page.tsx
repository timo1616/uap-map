import { readFile } from 'fs/promises';
import path from 'path';
import dynamic from 'next/dynamic';
import type { Sighting } from '@/lib/scraper';

// Map uses browser-only APIs — must be client-side only
const MapClient = dynamic(() => import('@/components/MapClient'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100dvh',
        background: '#050810',
        fontFamily: "'IBM Plex Mono', monospace",
        color: 'rgba(0,200,140,0.5)',
        fontSize: '11px',
        letterSpacing: '0.14em',
      }}
    >
      LOADING INCIDENT DATABASE…
    </div>
  ),
});

export default async function Page() {
  let sightings: Sighting[] = [];

  try {
    const raw = await readFile(
      path.join(process.cwd(), 'data', 'sightings.json'),
      'utf-8',
    );
    sightings = JSON.parse(raw) as Sighting[];
  } catch {
    // Scraper hasn't run yet — render empty map
  }

  return <MapClient sightings={sightings} />;
}
