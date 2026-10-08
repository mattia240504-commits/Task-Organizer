import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode, route } from "../src/geo";

afterEach(() => vi.unstubAllGlobals());

describe("geocode e percorso (servizi simulati)", () => {
  it("sceglie il risultato più vicino all'utente", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: URL | string) => {
      calls.push(String(url));
      return Response.json([
        { lat: "45.50", lon: "9.30", name: "Farmacia Lontana", display_name: "Farmacia Lontana, Milano" },
        { lat: "45.4785", lon: "9.2260", name: "Farmacia Vicina", display_name: "Farmacia Vicina, Via X, Milano" },
      ]);
    });
    const p = await geocode("farmacia", { lat: 45.4781, lon: 9.2254 });
    expect(p?.name).toBe("Farmacia Vicina");
    expect(calls[0]).toContain("bounded=1");
  });

  it("usa i dati stradali di OSRM e ripiega sulla stima se non risponde", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ routes: [{ distance: 4200, duration: 600 }] }));
    expect(await route({ lat: 45.4781, lon: 9.2254 }, { lat: 45.4642, lon: 9.19 })).toMatchObject({ distance_m: 4200, drive_min: 10 });
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    const r = await route({ lat: 45.4781, lon: 9.2254 }, { lat: 45.4642, lon: 9.19 });
    expect(r.drive_min).toBeNull();
    expect(r.distance_m).toBeGreaterThan(3900);
  });
});
