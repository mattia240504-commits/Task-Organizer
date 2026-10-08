// Conversioni tra ora locale (fuso dell'utente) e UTC, senza librerie esterne.

const pad = (n: number) => String(n).padStart(2, "0");

/** Differenza in ms tra l'ora locale nel fuso `tz` e UTC all'istante `utcMs`. */
export function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** "YYYY-MM-DDTHH:MM" in ora locale -> ms UTC. */
export function localToUtc(local: string, tz: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) throw new Error(`Data non valida: ${local}`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = guess - tzOffsetMs(guess, tz);
  // Secondo passaggio per i cambi d'ora legale
  utc = guess - tzOffsetMs(utc, tz);
  return utc;
}

/** ms UTC -> "YYYY-MM-DDTHH:MM" in ora locale. */
export function utcToLocal(utcMs: number, tz: string): string {
  const d = new Date(utcMs + tzOffsetMs(utcMs, tz));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const WEEKDAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/** Descrizione del momento attuale per il prompt di Claude. */
export function describeNow(utcMs: number, tz: string) {
  const local = utcToLocal(utcMs, tz);
  const [date, time] = local.split("T");
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return { local, date, time, weekday };
}

export type Recurrence = "nessuna" | "giornaliera" | "feriali" | "settimanale" | "mensile";

/** Prossima occorrenza (ora locale) di un promemoria ricorrente. */
export function nextOccurrence(local: string, rule: Recurrence): string | null {
  if (rule === "nessuna") return null;
  const [date, time] = local.split("T");
  const d = new Date(`${date}T00:00:00Z`);
  if (rule === "giornaliera") d.setUTCDate(d.getUTCDate() + 1);
  else if (rule === "settimanale") d.setUTCDate(d.getUTCDate() + 7);
  else if (rule === "mensile") d.setUTCMonth(d.getUTCMonth() + 1);
  else if (rule === "feriali") {
    do d.setUTCDate(d.getUTCDate() + 1);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  }
  return `${d.toISOString().slice(0, 10)}T${time}`;
}

/** Avanza una ricorrenza finché non supera `afterUtc` (utile se il server è rimasto fermo). */
export function nextOccurrenceAfter(local: string, rule: Recurrence, afterUtc: number, tz: string): string | null {
  let next = nextOccurrence(local, rule);
  for (let i = 0; next && i < 400 && localToUtc(next, tz) <= afterUtc; i++) next = nextOccurrence(next, rule);
  return next;
}
