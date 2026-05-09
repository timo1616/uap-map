export interface Sighting {
  id: string;
  date: string;
  location: string;
  lat: number;
  lng: number;
  description: string;
  source: string;
  classification: string;
}

export const sightings: Sighting[] = [];
