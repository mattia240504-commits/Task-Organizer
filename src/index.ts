// Server dei promemoria vocali: API per Siri/Comandi rapidi e per la web app, più il controllo
// periodico (cron) che invia le notifiche.
import { interpret, type NewReminder, type OpenReminder } from "./parser";
import { describeRoute, geocode, route, type LatLon } from "./geo";
import { sendPush, type PushMessage, type VapidKeys } from "./push";
import { describeNow, localToUtc, nextOccurrence, nextOccurrenceAfter, type Recurrence } from "./time";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_TOKEN: string;
  TIMEZONE: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT: string;
}

export interface ReminderRow {
  id: string;
  title: string;
  notes: string | null;
  category: string;
  priority: string;
  kind: string;
  due_date: string | null;
  due_time: string | null;
  remind_at: string | null;
  remind_at_utc: number | null;
  recurrence: Recurrence;
  notified: number;
  done: number;
  done_at: number | null;
  place_query: string | null;
  place_name: string | null;
  place_address: string | null;
  place_lat: number | null;
  place_lon: number | null;
  distance_m: number | null;
  drive_min: number | null;
  walk_min: number | null;
  source_text: string | null;
  created_at: number;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function authorized(req: Request, env: Env): boolean {
  if (!env.APP_TOKEN) return false;
  const url = new URL(req.url);
  const header = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim();
  return header === env.APP_TOKEN || url.searchParams.get("token") === env.APP_TOKEN;
}

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string) {
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

async function timezone(env: Env): Promise<string> {
  return (await getSetting(env, "timezone")) || env.TIMEZONE || "Europe/Rome";
}

function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("it", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Ripulisce i campi prodotti dall'interprete e calcola l'istante UTC della notifica. */
export function normalize(r: NewReminder, tz: string) {
  const due_date = r.due_date && DATE_RE.test(r.due_date) ? r.due_date : null;
  const due_time = due_date && r.due_time && TIME_RE.test(r.due_time) ? r.due_time : null;
  let remind_at = r.remind_at && LOCAL_RE.test(r.remind_at.slice(0, 16)) ? r.remind_at.slice(0, 16) : null;
  if (!remind_at && due_date) remind_at = `${due_date}T${due_time ?? "09:00"}`;
  const remind_at_utc = remind_at ? localToUtc(remind_at, tz) : null;
  const recurrence: Recurrence = remind_at ? r.recurrence : "nessuna";
  return { due_date, due_time, remind_at, remind_at_utc, recurrence };
}

async function openReminders(env: Env): Promise<ReminderRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM reminders WHERE done = 0 ORDER BY remind_at_utc IS NULL, remind_at_utc, created_at",
  ).all<ReminderRow>();
  return results;
}

async function handleVoice(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    text?: string;
    lat?: number | string;
    lon?: number | string;
    timezone?: string;
  };
  const text = (body.text ?? "").toString().trim();
  if (!text) return json({ reply: "Non ho sentito nulla. Riprova." }, 400);

  if (validTimezone(body.timezone)) await setSetting(env, "timezone", body.timezone);
  const tz = await timezone(env);
  const lat = Number(String(body.lat ?? "").replace(",", "."));
  const lon = Number(String(body.lon ?? "").replace(",", "."));
  const here: LatLon | undefined =
    body.lat != null && body.lon != null && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)
      ? { lat, lon }
      : undefined;

  const open = await openReminders(env);
  const result = interpret(
    text,
    describeNow(Date.now(), tz),
    open.map(
      (r): OpenReminder => ({
        id: r.id,
        title: r.title,
        due_date: r.due_date,
        due_time: r.due_time,
        remind_at: r.remind_at,
        recurrence: r.recurrence,
        place_name: r.place_name,
      }),
    ),
  );

  const openIds = new Set(open.map((r) => r.id));
  const created: ReminderRow[] = [];
  const distanceNotes: string[] = [];

  for (const r of result.create) {
    const n = normalize(r, tz);
    const row: ReminderRow = {
      id: crypto.randomUUID(),
      title: r.title.trim(),
      notes: r.notes?.trim() || null,
      category: r.category,
      priority: r.priority,
      kind: r.kind,
      ...n,
      notified: 0,
      done: 0,
      done_at: null,
      place_query: r.place_query?.trim() || null,
      place_name: null,
      place_address: null,
      place_lat: null,
      place_lon: null,
      distance_m: null,
      drive_min: null,
      walk_min: null,
      source_text: text,
      created_at: Date.now(),
    };

    if (row.place_query) {
      try {
        const place = await geocode(row.place_query, here);
        if (place) {
          row.place_name = place.name;
          row.place_address = place.address;
          row.place_lat = place.lat;
          row.place_lon = place.lon;
          if (here) {
            const rt = await route(here, place);
            row.distance_m = rt.distance_m;
            row.drive_min = rt.drive_min;
            row.walk_min = rt.walk_min;
            distanceNotes.push(`${place.name} è ${describeRoute(rt)}`);
          }
        }
      } catch (e) {
        console.error("Geocodifica fallita", e);
      }
    }

    await env.DB.prepare(
      `INSERT INTO reminders (id, title, notes, category, priority, kind, due_date, due_time, remind_at, remind_at_utc,
        recurrence, notified, done, done_at, place_query, place_name, place_address, place_lat, place_lon,
        distance_m, drive_min, walk_min, source_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        row.id, row.title, row.notes, row.category, row.priority, row.kind, row.due_date, row.due_time, row.remind_at,
        row.remind_at_utc, row.recurrence, row.notified, row.done, row.done_at, row.place_query, row.place_name,
        row.place_address, row.place_lat, row.place_lon, row.distance_m, row.drive_min, row.walk_min, row.source_text,
        row.created_at,
      )
      .run();
    created.push(row);
  }

  const completed: string[] = [];
  for (const id of result.complete_ids.filter((id) => openIds.has(id))) {
    await completeReminder(env, id, tz);
    completed.push(id);
  }
  const deleted: string[] = [];
  for (const id of result.delete_ids.filter((id) => openIds.has(id))) {
    await env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(id).run();
    deleted.push(id);
  }

  let reply = result.reply.trim();
  if (distanceNotes.length) reply += ` ${distanceNotes.join(". ")}.`;
  return json({ reply, created, completed, deleted });
}

/** Segna come fatto; se è ricorrente lo sposta alla prossima occorrenza. */
async function completeReminder(env: Env, id: string, tz: string) {
  const r = await env.DB.prepare("SELECT * FROM reminders WHERE id = ?").bind(id).first<ReminderRow>();
  if (!r) return null;
  if (r.recurrence !== "nessuna" && r.remind_at) {
    await advanceRecurring(env, r, tz);
  } else {
    await env.DB.prepare("UPDATE reminders SET done = 1, done_at = ? WHERE id = ?").bind(Date.now(), id).run();
  }
  return env.DB.prepare("SELECT * FROM reminders WHERE id = ?").bind(id).first<ReminderRow>();
}

async function advanceRecurring(env: Env, r: ReminderRow, tz: string, after = Date.now()) {
  const next = nextOccurrenceAfter(r.remind_at!, r.recurrence, after, tz)!;
  const shiftDays = Math.round((Date.parse(next.slice(0, 10)) - Date.parse(r.remind_at!.slice(0, 10))) / 86400000);
  let due_date = r.due_date;
  if (due_date) {
    const d = new Date(`${due_date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + shiftDays);
    due_date = d.toISOString().slice(0, 10);
  }
  await env.DB.prepare("UPDATE reminders SET remind_at = ?, remind_at_utc = ?, due_date = ?, notified = 0 WHERE id = ?")
    .bind(next, localToUtc(next, tz), due_date, r.id)
    .run();
}

async function handleUpdate(req: Request, env: Env, id: string): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Partial<ReminderRow> & { done?: boolean };
  const tz = await timezone(env);
  const existing = await env.DB.prepare("SELECT * FROM reminders WHERE id = ?").bind(id).first<ReminderRow>();
  if (!existing) return json({ error: "Promemoria non trovato" }, 404);

  if (body.done === true) return json(await completeReminder(env, id, tz));
  if (body.done === false) {
    await env.DB.prepare("UPDATE reminders SET done = 0, done_at = NULL WHERE id = ?").bind(id).run();
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of ["title", "notes"] as const) {
    if (typeof body[key] === "string") {
      fields.push(`${key} = ?`);
      values.push((body[key] as string).trim() || null);
    }
  }
  if (body.remind_at !== undefined) {
    const local = body.remind_at && LOCAL_RE.test(body.remind_at) ? body.remind_at : null;
    fields.push("remind_at = ?", "remind_at_utc = ?", "notified = 0");
    values.push(local, local ? localToUtc(local, tz) : null);
  }
  if (fields.length) {
    await env.DB.prepare(`UPDATE reminders SET ${fields.join(", ")} WHERE id = ?`).bind(...values, id).run();
  }
  return json(await env.DB.prepare("SELECT * FROM reminders WHERE id = ?").bind(id).first<ReminderRow>());
}

function vapid(env: Env): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

async function broadcast(env: Env, msg: PushMessage): Promise<number> {
  const keys = vapid(env);
  if (!keys) return 0;
  const { results } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM subscriptions").all<{
    endpoint: string;
    p256dh: string;
    auth: string;
  }>();
  let sent = 0;
  for (const sub of results) {
    try {
      const status = await sendPush(sub, msg, keys);
      if (status === 404 || status === 410) {
        await env.DB.prepare("DELETE FROM subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
      } else if (status < 300) sent++;
      else console.error("Push rifiutata", status, sub.endpoint);
    } catch (e) {
      console.error("Errore push", e);
    }
  }
  return sent;
}

function notificationFor(r: ReminderRow): PushMessage {
  const parts: string[] = [];
  if (r.due_time && r.kind === "appuntamento") parts.push(`Alle ${r.due_time}`);
  if (r.kind === "scadenza" && r.due_date) parts.push(`Scade il ${r.due_date.split("-").reverse().join("/")}`);
  if (r.place_name) parts.push(r.place_name);
  if (r.notes) parts.push(r.notes);
  return { title: r.title, body: parts.join(" · ") || "Promemoria", tag: r.id, url: `/?id=${r.id}` };
}

/** Eseguito ogni minuto dal cron: invia le notifiche scadute e il riepilogo del mattino. */
export async function runScheduled(env: Env, now = Date.now()) {
  const tz = await timezone(env);
  const { results: due } = await env.DB.prepare(
    "SELECT * FROM reminders WHERE done = 0 AND notified = 0 AND remind_at_utc IS NOT NULL AND remind_at_utc <= ?",
  )
    .bind(now)
    .all<ReminderRow>();

  for (const r of due) {
    await broadcast(env, notificationFor(r));
    await env.DB.prepare("UPDATE reminders SET notified = 1 WHERE id = ?").bind(r.id).run();
  }

  // I ricorrenti già notificati restano nella lista finché non li segni come fatti;
  // se arriva l'occorrenza successiva senza che tu l'abbia fatto, passano a quella (e ri-notificano).
  const { results: recurring } = await env.DB.prepare(
    "SELECT * FROM reminders WHERE done = 0 AND notified = 1 AND recurrence != 'nessuna' AND remind_at IS NOT NULL",
  ).all<ReminderRow>();
  for (const r of recurring) {
    const next = nextOccurrence(r.remind_at!, r.recurrence);
    if (next && localToUtc(next, tz) <= now) await advanceRecurring(env, r, tz, now - 60_000);
  }

  // Riepilogo del mattino
  const { date, time } = describeNow(now, tz);
  const digestTime = (await getSetting(env, "digest_time")) || "08:00";
  if (digestTime !== "off" && time >= digestTime && (await getSetting(env, "last_digest")) !== date) {
    await setSetting(env, "last_digest", date);
    const { results: today } = await env.DB.prepare(
      "SELECT title FROM reminders WHERE done = 0 AND (due_date <= ? OR substr(remind_at, 1, 10) <= ?) ORDER BY remind_at",
    )
      .bind(date, date)
      .all<{ title: string }>();
    if (today.length) {
      await broadcast(env, {
        title: today.length === 1 ? "Oggi hai 1 cosa da fare" : `Oggi hai ${today.length} cose da fare`,
        body: today.map((t) => t.title).join(" · "),
        tag: `riepilogo-${date}`,
        url: "/",
      });
    }
  }
  return due.length;
}

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
      },
    });
  }
  if (path === "/api/health") return json({ ok: true });
  if (path === "/api/vapid-public-key") return json({ key: env.VAPID_PUBLIC_KEY ?? null });
  if (!authorized(req, env)) return json({ error: "Token non valido", reply: "Token non valido: controlla il comando rapido." }, 401);

  if (path === "/api/voice" && req.method === "POST") return handleVoice(req, env);

  if (path === "/api/reminders" && req.method === "GET") {
    const includeDone = url.searchParams.get("done") === "1";
    const { results } = await env.DB.prepare(
      includeDone
        ? "SELECT * FROM reminders WHERE done = 1 ORDER BY done_at DESC LIMIT 100"
        : "SELECT * FROM reminders WHERE done = 0 ORDER BY remind_at_utc IS NULL, remind_at_utc, created_at",
    ).all<ReminderRow>();
    return json({ reminders: results, timezone: await timezone(env) });
  }

  const m = /^\/api\/reminders\/([\w-]+)$/.exec(path);
  if (m && req.method === "PATCH") return handleUpdate(req, env, m[1]);
  if (m && req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(m[1]).run();
    return json({ ok: true });
  }

  if (path === "/api/subscribe" && req.method === "POST") {
    const sub = (await req.json()) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return json({ error: "Iscrizione non valida" }, 400);
    await env.DB.prepare(
      "INSERT INTO subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
    )
      .bind(sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now())
      .run();
    return json({ ok: true });
  }
  if (path === "/api/unsubscribe" && req.method === "POST") {
    const { endpoint } = (await req.json()) as { endpoint?: string };
    await env.DB.prepare("DELETE FROM subscriptions WHERE endpoint = ?").bind(endpoint ?? "").run();
    return json({ ok: true });
  }
  if (path === "/api/test-push" && req.method === "POST") {
    const sent = await broadcast(env, { title: "Funziona! 🎉", body: "Le notifiche dei promemoria sono attive.", url: "/" });
    return json({ sent });
  }

  if (path === "/api/settings") {
    if (req.method === "POST") {
      const body = (await req.json()) as { timezone?: string; digest_time?: string };
      if (validTimezone(body.timezone)) await setSetting(env, "timezone", body.timezone);
      if (body.digest_time === "off" || (body.digest_time && TIME_RE.test(body.digest_time))) {
        await setSetting(env, "digest_time", body.digest_time);
      }
    }
    return json({ timezone: await timezone(env), digest_time: (await getSetting(env, "digest_time")) || "08:00" });
  }

  return json({ error: "Non trovato" }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(req, env, url);
      } catch (e) {
        console.error(e);
        return json({ error: String(e), reply: "Si è verificato un errore, riprova tra poco." }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
