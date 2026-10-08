import { describe, expect, it } from "vitest";
import { describeNow, localToUtc, nextOccurrence, nextOccurrenceAfter, utcToLocal } from "../src/time";

const TZ = "Europe/Rome";

describe("ora locale", () => {
  it("converte ora legale e solare", () => {
    expect(new Date(localToUtc("2026-07-10T09:00", TZ)).toISOString()).toBe("2026-07-10T07:00:00.000Z");
    expect(new Date(localToUtc("2026-12-10T09:00", TZ)).toISOString()).toBe("2026-12-10T08:00:00.000Z");
  });
  it("è reversibile", () => {
    const utc = localToUtc("2026-10-25T18:30", TZ);
    expect(utcToLocal(utc, TZ)).toBe("2026-10-25T18:30");
  });
  it("descrive il giorno della settimana", () => {
    expect(describeNow(Date.parse("2026-10-08T10:00:00Z"), TZ)).toEqual({
      local: "2026-10-08T12:00",
      date: "2026-10-08",
      time: "12:00",
      weekday: "giovedì",
    });
  });
});

describe("ricorrenze", () => {
  it("giornaliera, settimanale, mensile", () => {
    expect(nextOccurrence("2026-10-08T08:00", "giornaliera")).toBe("2026-10-09T08:00");
    expect(nextOccurrence("2026-10-08T08:00", "settimanale")).toBe("2026-10-15T08:00");
    expect(nextOccurrence("2026-10-08T08:00", "mensile")).toBe("2026-11-08T08:00");
    expect(nextOccurrence("2026-10-08T08:00", "nessuna")).toBeNull();
  });
  it("feriali salta il weekend", () => {
    expect(nextOccurrence("2026-10-09T08:00", "feriali")).toBe("2026-10-12T08:00");
  });
  it("recupera le occorrenze perse", () => {
    const now = localToUtc("2026-10-08T12:00", TZ);
    expect(nextOccurrenceAfter("2026-10-01T08:00", "giornaliera", now, TZ)).toBe("2026-10-09T08:00");
  });
});
