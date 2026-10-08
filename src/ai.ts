// Interpretazione con l'IA gratuita di Cloudflare (Workers AI, modello open source).
// Se l'IA non è disponibile, sbaglia formato o finisce il limite gratuito giornaliero,
// restituisce null e il server usa l'interprete a regole (parser.ts).
import {
  CATEGORIES,
  KINDS,
  PRIORITIES,
  RECURRENCES,
  emptyResult,
  type NewReminder,
  type Now,
  type OpenReminder,
  type ReminderUpdate,
  type VoiceResult,
} from "./parser";

export const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const WEEKDAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

const SCHEMA = {
  type: "object",
  properties: {
    create: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          notes: { type: "string" },
          category: { type: "string", enum: [...CATEGORIES] },
          priority: { type: "string", enum: [...PRIORITIES] },
          kind: { type: "string", enum: [...KINDS] },
          due_date: { type: "string" },
          due_time: { type: "string" },
          remind_at: { type: "string" },
          recurrence: { type: "string", enum: [...RECURRENCES] },
          place_query: { type: "string" },
        },
        required: ["title", "notes", "category", "priority", "kind", "due_date", "due_time", "remind_at", "recurrence", "place_query"],
      },
    },
    update: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          due_date: { type: "string" },
          due_time: { type: "string" },
          remind_at: { type: "string" },
          recurrence: { type: "string" },
        },
        required: ["id", "title", "due_date", "due_time", "remind_at", "recurrence"],
      },
    },
    complete_ids: { type: "array", items: { type: "string" } },
    delete_ids: { type: "array", items: { type: "string" } },
    question: { type: "string" },
    reply: { type: "string" },
  },
  required: ["create", "update", "complete_ids", "delete_ids", "question", "reply"],
} as const;

const SYSTEM_PROMPT = `Sei l'assistente per i promemoria di un utente italiano. Ricevi la trascrizione di ciò che ha detto a Siri (spesso imprecisa, senza punteggiatura, con errori di dettatura) e la trasformi in azioni sulla sua lista. Rispondi SOLO con il JSON richiesto.

Regole:
- Capisci cosa intende davvero, correggi gli errori di trascrizione e riscrivi ogni promemoria in modo chiaro e conciso: titolo breve con maiuscola iniziale, verbo all'infinito o sostantivo, niente "ricordami di".
- Se elenca più cose crea un promemoria per ciascuna. Se un elemento dell'elenco non ha verbo, usa quello degli altri ("fare la spesa, la lavatrice" -> "Fare la lavatrice").
- Le date relative vanno convertite in date assolute usando il CALENDARIO fornito. Non calcolare i giorni della settimana a mente: copia la data dal calendario. "Venerdì" = il prossimo venerdì nel calendario (non oggi).
- Formati: due_date "YYYY-MM-DD", due_time "HH:MM", remind_at "YYYY-MM-DDTHH:MM" (ora locale). Usa "" (stringa vuota) per i valori assenti, mai null.
- remind_at è il momento della notifica:
  - ora esplicita -> quell'ora;
  - appuntamento a un'ora precisa (medico, riunione, cena...) -> 30 minuti prima, o 60 se c'è un luogo da raggiungere;
  - solo il giorno -> 09:00 di quel giorno; "stasera" -> 19:00; "pomeriggio" -> 15:00; "mattina" -> 09:00;
  - "oggi" senza ora -> tra 30 minuti rispetto all'ora attuale (se le 9 sono già passate);
  - scadenza ("entro il 20", "scade", "va pagato entro") -> kind "scadenza", due_date = la scadenza, remind_at = il giorno prima alle 09:00;
  - nessuna indicazione di tempo -> "".
- Orari: "alle 3" senza altro = 15:00; "alle 9" = 09:00; "alle 7" è ambiguo se non c'è contesto (cena/sera -> 19:00, sveglia/colazione -> 07:00).
- Ricorrenze: "ogni giorno/tutte le mattine" -> giornaliera; "nei giorni feriali" -> feriali; "ogni lunedì" -> settimanale (remind_at sul prossimo lunedì); "ogni mese/il 5 di ogni mese" -> mensile.
- kind: "appuntamento" (evento a un'ora precisa), "scadenza", "luogo" (bisogna andare in un posto senza orario preciso), altrimenti "cosa_da_fare".
- Se bisogna andare fisicamente in un posto, metti in place_query un testo da cercare sulla mappa (es. "farmacia", "via Torino 12, Milano"). Per luoghi generici usa solo il tipo di posto. Altrimenti "".
- priority "alta" solo se l'utente dice urgente/importante o per scadenze con conseguenze (pagamenti, documenti).
- Promemoria esistenti (con id nella lista): se dice di averne fatto uno -> complete_ids; se chiede di cancellarlo -> delete_ids; se chiede di spostarlo/rimandarlo/anticiparlo/rinominarlo/cambiarlo -> update con l'id e SOLO i campi che cambiano (gli altri ""). Quando cambi data o ora, ricalcola anche remind_at.
- question: fai una domanda all'utente SOLO se la frase è davvero ambigua o incomprensibile (es. "alle 7" senza capire se mattina o sera, non è chiaro quale promemoria modificare, la frase non ha senso). Anche quando fai una domanda, riempi create/update con la tua interpretazione migliore. Altrimenti question = "".
- reply: una o due frasi naturali in italiano da leggere ad alta voce, che confermano cosa hai fatto. Niente elenchi, niente emoji, niente id.`;

function calendar(now: Now): string {
  const lines: string[] = [];
  const base = new Date(`${now.date}T00:00:00Z`);
  for (let i = 0; i < 21; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const label = i === 0 ? " (oggi)" : i === 1 ? " (domani)" : i === 2 ? " (dopodomani)" : "";
    lines.push(`${WEEKDAYS[d.getUTCDay()]} ${d.toISOString().slice(0, 10)}${label}`);
  }
  return lines.join("\n");
}

function openList(open: OpenReminder[]): string {
  if (!open.length) return "(nessun promemoria aperto)";
  return open
    .slice(0, 60)
    .map((r) => {
      const when = [r.due_date, r.due_time].filter(Boolean).join(" ") || r.remind_at || "senza data";
      return `- [${r.id}] ${r.title} — ${when}${r.recurrence && r.recurrence !== "nessuna" ? ` (ricorrenza ${r.recurrence})` : ""}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Validazione della risposta del modello

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const opt = (v: unknown, re: RegExp) => {
  const s = str(v);
  return re.test(s) ? s.slice(0, 16) : null;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.includes(str(v) as T) ? (str(v) as T) : fallback;

export function sanitize(raw: unknown, open: OpenReminder[]): VoiceResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.create) || typeof r.reply !== "string") return null;
  const ids = new Set(open.map((o) => o.id));
  const out = emptyResult();

  for (const c of r.create as Record<string, unknown>[]) {
    const title = str(c?.title);
    if (!title) continue;
    const create: NewReminder = {
      title: title[0].toUpperCase() + title.slice(1),
      notes: str(c.notes) || null,
      category: oneOf(c.category, CATEGORIES, "altro"),
      priority: oneOf(c.priority, PRIORITIES, "normale"),
      kind: oneOf(c.kind, KINDS, "cosa_da_fare"),
      due_date: opt(c.due_date, DATE_RE),
      due_time: opt(c.due_time, TIME_RE),
      remind_at: opt(c.remind_at, LOCAL_RE),
      recurrence: oneOf(c.recurrence, RECURRENCES, "nessuna"),
      place_query: str(c.place_query) || null,
    };
    out.create.push(create);
  }

  for (const u of (Array.isArray(r.update) ? r.update : []) as Record<string, unknown>[]) {
    const id = str(u?.id);
    if (!ids.has(id)) continue;
    const update: ReminderUpdate = { id };
    if (str(u.title)) update.title = str(u.title);
    if (opt(u.due_date, DATE_RE)) update.due_date = opt(u.due_date, DATE_RE);
    if (opt(u.due_time, TIME_RE)) update.due_time = opt(u.due_time, TIME_RE);
    if (opt(u.remind_at, LOCAL_RE)) update.remind_at = opt(u.remind_at, LOCAL_RE);
    if (RECURRENCES.includes(str(u.recurrence) as NewReminder["recurrence"])) {
      update.recurrence = str(u.recurrence) as NewReminder["recurrence"];
    }
    if (Object.keys(update).length > 1) out.update.push(update);
  }

  const idList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((id) => ids.has(id)) : []);
  out.complete_ids = idList(r.complete_ids);
  out.delete_ids = idList(r.delete_ids);
  out.question = str(r.question) || null;
  out.reply = str(r.reply);
  return out;
}

function parseResponse(res: unknown): unknown {
  const body = (res as { response?: unknown })?.response ?? res;
  if (typeof body !== "string") return body;
  const m = /\{[\s\S]*\}/.exec(body); // a volte il JSON arriva come testo
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export interface AiContext {
  question: string;
  answer: string;
}

/** Interpreta la frase con Workers AI. Restituisce null se qualcosa va storto. */
export async function aiInterpret(
  ai: Ai | undefined,
  text: string,
  now: Now & { weekday?: string },
  timezone: string,
  open: OpenReminder[],
  followUp?: AiContext,
): Promise<VoiceResult | null> {
  if (!ai) return null;
  const user = `Adesso è ${now.weekday ?? ""} ${now.date}, ore ${now.time} (fuso ${timezone}).

CALENDARIO:
${calendar(now)}

Promemoria aperti:
${openList(open)}

Frase dell'utente:
"""${text}"""`;
  const messages: { role: string; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
  if (followUp) {
    messages.push(
      { role: "assistant", content: `Domanda per l'utente: ${followUp.question}` },
      {
        role: "user",
        content: `Risposta dell'utente alla tua domanda: """${followUp.answer}"""
Ora produci il risultato finale tenendo conto della risposta. Non fare altre domande: question deve essere "".`,
      },
    );
  }
  try {
    const res = await ai.run(AI_MODEL as Parameters<Ai["run"]>[0], {
      messages,
      response_format: { type: "json_schema", json_schema: SCHEMA },
      max_tokens: 1500,
      temperature: 0.1,
    } as never);
    const result = sanitize(parseResponse(res), open);
    if (result && followUp) result.question = null;
    return result;
  } catch (e) {
    console.error("Workers AI non disponibile, uso le regole:", e);
    return null;
  }
}
