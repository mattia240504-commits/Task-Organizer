// Geocodifica (OpenStreetMap / Nominatim) e calcolo distanza/tempi (OSRM).
// Servizi gratuiti, senza chiave: per un uso personale bastano e avanzano.

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Place extends LatLon {
  name: string;
  address: string;
}

export interface Route {
  distance_m: number;
  drive_min: number | null;
  walk_min: number;
}

const USER_AGENT = "promemoria-claude/1.0 (assistente personale)";

/** Distanza in linea d'aria (metri). */
export function haversine(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
}

async function nominatim(params: Record<string, string>): Promise<NominatimResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  for (const [k, v] of Object.entries({ format: "jsonv2", limit: "8", "accept-language": "it", ...params })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return [];
  return (await res.json()) as NominatimResult[];
}

/**
 * Cerca un luogo. Se conosciamo la posizione dell'utente cerca prima nei dintorni
 * (circa 15 km) e sceglie il risultato più vicino: "la farmacia" diventa la farmacia più vicina.
 */
export async function geocode(query: string, near?: LatLon): Promise<Place | null> {
  let results: NominatimResult[] = [];
  if (near) {
    const d = 0.15;
    results = await nominatim({
      q: query,
      viewbox: `${near.lon - d},${near.lat + d},${near.lon + d},${near.lat - d}`,
      bounded: "1",
    });
  }
  if (results.length === 0) results = await nominatim({ q: query });
  if (results.length === 0) return null;

  const places = results.map((r) => ({
    lat: Number(r.lat),
    lon: Number(r.lon),
    name: r.name || r.display_name.split(",")[0],
    address: r.display_name,
  }));
  if (near) places.sort((a, b) => haversine(near, a) - haversine(near, b));
  return places[0];
}

/** Distanza e tempi di percorrenza stimati da `from` a `to`. */
export async function route(from: LatLon, to: LatLon): Promise<Route> {
  const straight = haversine(from, to);
  let distance_m = straight * 1.3; // stima prudente se il calcolo stradale non risponde
  let drive_min: number | null = null;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) {
      const data = (await res.json()) as { routes?: { distance: number; duration: number }[] };
      const r = data.routes?.[0];
      if (r) {
        distance_m = r.distance;
        drive_min = r.duration / 60;
      }
    }
  } catch {
    // ignoriamo: resta la stima in linea d'aria
  }
  // A piedi ~4,8 km/h sulla distanza in linea d'aria maggiorata del 25%
  const walk_min = (straight * 1.25) / 80;
  return { distance_m, drive_min, walk_min };
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} metri` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Frase da leggere ad alta voce, es. "a 2,3 km, circa 6 min in auto". */
export function describeRoute(r: Route): string {
  const parts = [`a ${formatDistance(r.distance_m)}`];
  if (r.walk_min <= 25) parts.push(`circa ${formatMinutes(r.walk_min)} a piedi`);
  else if (r.drive_min != null) parts.push(`circa ${formatMinutes(r.drive_min)} in auto`);
  return parts.join(", ");
}
