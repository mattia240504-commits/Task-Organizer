// Interpretazione delle frasi dettate con Claude: da linguaggio naturale a promemoria strutturati.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const CATEGORIES = ["lavoro", "casa", "spesa", "salute", "studio", "personale", "commissioni", "altro"] as const;
export const PRIORITIES = ["bassa", "normale", "alta"] as const;
export const KINDS = ["cosa_da_fare", "appuntamento", "scadenza", "luogo"] as const;
export const RECURRENCES = ["nessuna", "giornaliera", "feriali", "settimanale", "mensile"] as const;

const NewReminder = z.object({
  title: z.string().describe("Titolo breve e chiaro, con verbo all'infinito o sostantivo (es. 'Ritirare la giacca in lavanderia')"),
  notes: z.string().nullable().describe("Dettagli utili ricavati dalla frase, oppure null"),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  kind: z.enum(KINDS),
  due_date: z.string().nullable().describe("Data di scadenza/evento YYYY-MM-DD, oppure null"),
  due_time: z.string().nullable().describe("Ora dell'evento HH:MM, oppure null"),
  remind_at: z.string().nullable().describe("Quando mandare la notifica, YYYY-MM-DDTHH:MM in ora locale, oppure null"),
  recurrence: z.enum(RECURRENCES),
  place_query: z
    .string()
    .nullable()
    .describe("Se bisogna andare in un posto: testo da cercare sulla mappa (es. 'farmacia', 'Esselunga viale Monza Milano'), altrimenti null"),
});

export const VoiceResult = z.object({
  create: z.array(NewReminder),
  complete_ids: z.array(z.string()).describe("Id dei promemoria esistenti che l'utente dice di aver fatto"),
  delete_ids: z.array(z.string()).describe("Id dei promemoria esistenti da eliminare"),
  reply: z.string().describe("Risposta breve in italiano da leggere ad alta voce"),
});

export type NewReminder = z.infer<typeof NewReminder>;
export type VoiceResult = z.infer<typeof VoiceResult>;

const SYSTEM_PROMPT = `Sei l'assistente vocale per i promemoria dell'utente, che parla italiano. Ricevi la trascrizione di ciò che ha detto (spesso imprecisa, senza punteggiatura, con errori di dettatura) e la trasformi in azioni sulla sua lista.

Cosa fare:
- Capisci cosa intende davvero, correggi gli errori di trascrizione e riscrivi ogni promemoria in modo chiaro e conciso. Titoli brevi, maiuscola iniziale, niente "ricordami di".
- Se elenca più cose ("oggi devo fare questo, questo e quest'altro") crea un promemoria separato per ciascuna.
- Date relative ("domani", "venerdì", "tra due settimane", "fine mese") vanno convertite in date assolute partendo dalla data e ora attuali che ti vengono date. "Venerdì" significa il prossimo venerdì (oggi se oggi è venerdì e l'ora non è passata).
- remind_at è il momento della notifica:
  - ora esplicita ("alle 15") → quell'ora;
  - appuntamento a un'ora precisa → di norma 30 minuti prima, o 60 se c'è un luogo da raggiungere;
  - solo il giorno, senza ora → alle 09:00 di quel giorno; "stasera" → 19:00; "stamattina"/"in mattinata" → 09:00 (o tra 15 minuti se già passate); "pomeriggio" → 15:00;
  - "cose da fare oggi" senza ora → oggi alle 09:00, oppure tra 30 minuti se le 9 sono già passate;
  - scadenza nelle prossime settimane ("entro il 20", "pagare il bollo entro fine mese") → kind "scadenza", due_date = giorno della scadenza, remind_at = il giorno prima alle 09:00 (o due giorni prima se è un compito lungo);
  - nessuna indicazione di tempo → null (resta in lista senza notifica).
- Ricorrenze: "ogni giorno"/"tutte le mattine" → giornaliera; "nei giorni feriali" → feriali; "ogni lunedì" → settimanale (remind_at sul prossimo lunedì); "ogni mese" → mensile.
- Se bisogna andare fisicamente in un posto (negozio, ufficio, medico, casa di qualcuno, indirizzo), compila place_query con un testo efficace da cercare sulla mappa, completandolo con la città se l'utente la nomina. Per luoghi generici ("la farmacia", "il supermercato") usa solo il tipo di luogo: verrà cercato quello più vicino all'utente.
- Priorità alta solo se l'utente dice che è urgente/importante o se è una scadenza con conseguenze (pagamenti, documenti, medico).
- Se l'utente dice di aver fatto qualcosa o chiede di cancellare/togliere un promemoria, usa complete_ids o delete_ids con gli id della lista attuale che ti viene fornita.
- Se fa una domanda ("cosa devo fare oggi?", "che impegni ho domani?"), non creare nulla e rispondi nel campo reply riassumendo la lista attuale.

Il campo reply viene letto ad alta voce da Siri: una o due frasi naturali, senza elenchi puntati né emoji, che confermano cosa hai capito (cosa e quando). Non citare gli id.`;

export interface OpenReminder {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  remind_at: string | null;
  recurrence: string;
  place_name: string | null;
}

export async function interpret(opts: {
  apiKey: string;
  baseURL?: string;
  text: string;
  now: { date: string; time: string; weekday: string };
  timezone: string;
  open: OpenReminder[];
}): Promise<VoiceResult> {
  const client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseURL || undefined });
  const list = opts.open.length
    ? opts.open
        .map((r) => {
          const when = [r.due_date, r.due_time].filter(Boolean).join(" ") || (r.remind_at ?? "senza data");
          const extra = [r.recurrence !== "nessuna" ? `ricorrenza ${r.recurrence}` : "", r.place_name ? `luogo: ${r.place_name}` : ""]
            .filter(Boolean)
            .join(", ");
          return `- [${r.id}] ${r.title} — ${when}${extra ? ` (${extra})` : ""}`;
        })
        .join("\n")
    : "(nessun promemoria aperto)";

  const message = await client.beta.messages.parse({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(VoiceResult) },
    messages: [
      {
        role: "user",
        content: `Adesso è ${opts.now.weekday} ${opts.now.date}, ore ${opts.now.time} (fuso ${opts.timezone}).

Promemoria aperti:
${list}

Frase dell'utente:
"""${opts.text}"""`,
      },
    ],
  });

  if (message.stop_reason === "refusal") {
    return { create: [], complete_ids: [], delete_ids: [], reply: "Mi dispiace, non posso aiutarti con questa richiesta." };
  }
  const parsed = message.parsed_output;
  if (!parsed) throw new Error(`Risposta di Claude non interpretabile (stop_reason: ${message.stop_reason})`);
  return parsed;
}
