import { describe, expect, it } from "vitest";
import { normalize } from "../src/index";
import { haversine, describeRoute } from "../src/geo";

const base = {
  title: "x", notes: null, category: "altro", priority: "normale", kind: "cosa_da_fare",
  due_date: null, due_time: null, remind_at: null, recurrence: "nessuna", place_query: null,
} as const;

describe("normalize", () => {
  it("usa le 9 del giorno di scadenza se manca l'ora della notifica", () => {
    const n = normalize({ ...base, due_date: "2026-10-20" }, "Europe/Rome");
    expect(n.remind_at).toBe("2026-10-20T09:00");
    expect(new Date(n.remind_at_utc!).toISOString()).toBe("2026-10-20T07:00:00.000Z");
  });
  it("scarta valori malformati e ricorrenze senza data", () => {
    const n = normalize({ ...base, due_date: "domani", remind_at: "boh", recurrence: "giornaliera" }, "Europe/Rome");
    expect(n).toEqual({ due_date: null, due_time: null, remind_at: null, remind_at_utc: null, recurrence: "nessuna" });
  });
});

describe("geo", () => {
  it("calcola distanze e frasi", () => {
    const d = haversine({ lat: 45.4642, lon: 9.19 }, { lat: 45.4781, lon: 9.2254 });
    expect(d).toBeGreaterThan(3000);
    expect(d).toBeLessThan(3200);
    expect(describeRoute({ distance_m: 850, drive_min: 3, walk_min: 11 })).toBe("a 850 metri, circa 11 min a piedi");
    expect(describeRoute({ distance_m: 12400, drive_min: 18.2, walk_min: 150 })).toBe("a 12,4 km, circa 18 min in auto");
  });
});
