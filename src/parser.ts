// Interprete delle frasi dettate in italiano, basato su regole: nessuna IA, nessun costo.
// Trasforma "domani alle 10 dentista, poi passare in farmacia" in promemoria strutturati.

export const CATEGORIES = ["lavoro", "casa", "spesa", "salute", "studio", "personale", "commissioni", "altro"] as const;
export const PRIORITIES = ["bassa", "normale", "alta"] as const;
export const KINDS = ["cosa_da_fare", "appuntamento", "scadenza", "luogo"] as const;
export const RECURRENCES = ["nessuna", "giornaliera", "feriali", "settimanale", "mensile"] as const;

export interface NewReminder {
  title: string;
  notes: string | null;
  category: (typeof CATEGORIES)[number];
  priority: (typeof PRIORITIES)[number];
  kind: (typeof KINDS)[number];
  due_date: string | null;
  due_time: string | null;
  remind_at: string | null;
  recurrence: (typeof RECURRENCES)[number];
  place_query: string | null;
}

export interface VoiceResult {
  create: NewReminder[];
  complete_ids: string[];
  delete_ids: string[];
  reply: string;
}

export interface OpenReminder {
  id: string;
  title: string;
  due_date: string | null;
  due_time: string | null;
  remind_at: string | null;
  recurrence: string;
  place_name: string | null;
}

export interface Now {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

// ---------------------------------------------------------------------------
// Utilità per date e ore (stringhe locali, senza fusi: il fuso lo gestisce time.ts)

const pad = (n: number) => String(n).padStart(2, "0");
const toDate = (d: Date) => d.toISOString().slice(0, 10);
const parseDate = (s: string) => new Date(`${s}T00:00:00Z`);

export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toDate(d);
}

function addMonths(date: string, n: number): string {
  const d = parseDate(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toDate(d);
}

function addMinutes(local: string, mins: number): string {
  const d = new Date(`${local}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + mins);
  return d.toISOString().slice(0, 16);
}

const weekdayOf = (date: string) => parseDate(date).getUTCDay(); // 0 = domenica

/** Ora attuale arrotondata ai 5 minuti successivi + `mins`. */
function soon(now: Now, mins: number): string {
  const base = addMinutes(`${now.date}T${now.time}`, mins);
  const m = Number(base.slice(14, 16));
  return addMinutes(base, (5 - (m % 5)) % 5);
}

// ---------------------------------------------------------------------------
// Vocabolario

const WEEKDAYS: Record<string, number> = {
  domenica: 0, lunedi: 1, martedi: 2, mercoledi: 3, giovedi: 4, venerdi: 5, sabato: 6,
};
const WEEKDAY_NAMES = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const END = "(?![A-Za-zÀ-ÿ0-9])"; // come \\b ma funziona anche dopo lettere accentate
const WD = `(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)${END}`;
const wdIndex = (w: string) => WEEKDAYS[w.toLowerCase().replace("ì", "i")];

const MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MONTH_RE = `(${MONTHS.join("|")})`;

const NUMBERS: Record<string, number> = {
  un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
  undici: 11, dodici: 12, tredici: 13, quattordici: 14, quindici: 15, sedici: 16, diciassette: 17, diciotto: 18,
  diciannove: 19, venti: 20, ventuno: 21, ventidue: 22, ventitre: 23, ventitré: 23, trenta: 30, quaranta: 40,
  quarantacinque: 45, cinquanta: 50,
};
const NUM_WORDS = Object.keys(NUMBERS).sort((a, b) => b.length - a.length).join("|");

const EVENING_RE = /\b(cena|aperitivo|sera|stasera|serata|notte|cinema|teatro|concerto|discoteca)/i;
const MORNING_RE = /\b(sveglia|mattin|colazione|domattina|stamattina|alba)/i;

const PERIODS: Record<string, string> = { mattina: "09:00", mattino: "09:00", pomeriggio: "15:00", sera: "19:00", notte: "22:00" };

const PLACE_WORDS = [
  "farmacia", "supermercato", "ipermercato", "ufficio postale", "posta", "banca", "bancomat", "lavanderia", "ferramenta",
  "panetteria", "panificio", "forno", "pasticceria", "macelleria", "pescheria", "fruttivendolo", "edicola", "tabaccheria",
  "tabaccaio", "benzinaio", "distributore", "ospedale", "pronto soccorso", "comune", "anagrafe", "questura", "palestra",
  "piscina", "parrucchiere", "barbiere", "estetista", "medico", "dottore", "dentista", "veterinario", "ottico", "stazione",
  "aeroporto", "biblioteca", "università", "scuola", "asilo", "chiesa", "mercato", "centro commerciale", "officina",
  "meccanico", "gommista", "carrozzeria", "autolavaggio", "ikea", "esselunga", "coop", "conad", "carrefour", "lidl",
  "eurospin", "penny", "aldi", "pam", "decathlon", "mediaworld", "unieuro", "leroy merlin", "brico", "bricocenter",
  "tintoria", "calzolaio", "sarta", "fioraio", "libreria", "cartoleria", "ambulatorio", "laboratorio analisi", "asl",
  "caf", "inps", "agenzia delle entrate", "motorizzazione", "notaio", "commercialista", "avvocato",
];
const PLACE_RE = new RegExp(`\\b(${PLACE_WORDS.sort((a, b) => b.length - a.length).join("|")})${END}`, "i");
const ADDRESS_RE =
  /\b(via|viale|piazza|piazzale|corso|largo|vicolo|strada|lungomare|lungarno|borgo|contrada)\s+((?:[a-zà-ú'.]+\s+){0,4}?[a-zà-ú'.]+)(\s*,?\s*\d+[a-z]?)?(?=\s*$|\s*[,.;]|\s+(?:a|ad|alle|entro|oggi|domani|stasera|il|e|per|poi|dalle)\b)/i;
const CITY_RE = /\b(?:a|ad)\s+([A-ZÀ-Ú][a-zà-ú']+(?:\s+[A-ZÀ-Ú][a-zà-ú']+)?)\b/;

const CATEGORY_WORDS: [NewReminder["category"], RegExp][] = [
  ["salute", /\b(medic|dottor|dentist|farmac|medicin|pillol|vitamin|visit|analisi|ospedal|ambulatori|terapi|vaccin|fisioterap|oculist|veterinari|asl|esami del sangue)/i],
  ["spesa", /\b(spesa|comprar|compra|latte|pane|uova|frutta|verdura|supermercat|esselunga|coop|conad|carrefour|lidl|eurospin|penny|aldi|pam|ipermercat|detersivo|carta igienica|acqua)/i],
  ["lavoro", /\b(riunion|call|meeting|client|ufficio|report|relazion|presentazion|mail|email|progett|colleg|capo|fattur|preventiv|contratt|colloqui)/i],
  ["studio", /\b(esam|studiar|lezion|compit|universit|scuola|tesi|corso di|ripasso|libro|professor)/i],
  ["casa", /\b(lavatric|lavastoviglie|pulir|pulizi|stender|spazzatur|rifiut|differenziat|cucinar|stirar|piante|annaffiar|bollett|affitto|condominio|idraulic|elettricist|casa)/i],
  ["commissioni", /\b(posta|banca|pagar|bollo|ritirar|spedir|pacco|lavanderia|tintoria|comune|anagrafe|document|passaporto|carta d'identit|patente|assicurazion|meccanic|officina|gommist|revision|tagliando|benzina|notaio|commercialista|caf|inps)/i],
  ["personale", /\b(chiamar|telefonar|sentire|mamma|papà|papa|nonn|fratell|sorell|amic|compleanno|regalo|anniversari|cena|pranzo|aperitivo|cinema|palestra|parrucchier|barbier|estetist)/i],
];

const APPOINTMENT_RE =
  /\b(appuntament|visita|riunion|call|meeting|incontr|colloqui|cena|pranzo|aperitivo|colazione|dentist|medic|dottor|parrucchier|barbier|estetist|veterinari|esame|lezione|partita|concerto|cinema|teatro|volo|treno|festa)/i;

const STOPWORDS = new Set(
  "il lo la i gli le l un uno una di a da in con su per tra fra e ed o del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle sul sullo sulla sui sugli sulle che mi ti si ci vi devo fare poi anche".split(
    " ",
  ),
);

// ---------------------------------------------------------------------------
// Pulizia del testo

function normalizeText(text: string): string {
  let s = ` ${text.replace(/[“”"«»]/g, " ").replace(/\s+/g, " ").trim()} `;
  // Parole d'attivazione e formule iniziali
  s = s.replace(/^\s*(?:(?:ehi|hey|ok|ciao)\s+)?(?:claude|siri)[,!.]?\s+/i, " ");
  // "le tre" -> "le 3", "all'una" -> "alle 1"
  s = s.replace(/\ball'una\b/gi, "alle 1");
  s = s.replace(new RegExp(`\\b(alle|le|ore|dalle|verso le|entro le|per le)\\s+(${NUM_WORDS})\\b`, "gi"), (_, p, n) => `${p} ${NUMBERS[n.toLowerCase()]}`);
  s = s.replace(new RegExp(`\\b(tra|fra)\\s+(${NUM_WORDS})\\b`, "gi"), (_, p, n) => `${p} ${NUMBERS[n.toLowerCase()]}`);
  s = s.replace(new RegExp(`\\b(\\d{1,2})\\s+e\\s+(${NUM_WORDS})\\b(?!\\s+quarto)`, "gi"), (_, h, n) => `${h} e ${NUMBERS[n.toLowerCase()]}`);
  return s;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

const LEADING_FILLERS =
  /^(?:(?:e|poi|ok|allora|inoltre|anche|e poi|e anche|oppure|infine|dopo)\s+)*(?:(?:ricordami|ricorda(?:mi)?|ricordarmi|segna(?:mi)?|aggiungi|metti|nota|promemoria|memo|scrivi|annota)\s+)?(?:(?:di|che|per|a|un promemoria(?: per)?|il promemoria(?: per)?)\s+)?(?:(?:io\s+)?(?:devo|dovrei|dovrò|bisogna|mi serve|mi tocca|ho da|tocca|devi|si deve|serve|voglio|vorrei|mi devo ricordare di|mi ricordo di)\s+)*(?:(?:anche|ancora|assolutamente|poi)\s+)*/i;

function makeTitle(s: string): string {
  let t = clean(s.replace(/[,;:.!?]+/g, " "));
  for (let i = 0; i < 3; i++) t = t.replace(LEADING_FILLERS, "").trim();
  t = t.replace(/\b(?:per favore|grazie|per piacere|ok)\b/gi, " ");
  t = t.replace(/^(?:di|che|a|per|e)\s+/i, "");
  t = t.replace(/\s+(?:di|a|per|e|il|la|lo|alle|al|entro|da|in|che|ricordami)$/i, "");
  t = clean(t);
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

// ---------------------------------------------------------------------------
// Estrazione dal singolo segmento

interface Extracted {
  date: string | null;
  time: string | null;
  period: string | null;
  deadline: boolean;
  recurrence: NewReminder["recurrence"];
  priority: NewReminder["priority"];
  place: string | null;
  title: string;
  explicitDate: boolean;
  relative: string | null; // "tra 20 minuti" -> istante locale preciso
  notes: string | null;
}

function nextWeekday(today: string, wd: number, allowToday: boolean): string {
  let diff = (wd - weekdayOf(today) + 7) % 7;
  if (diff === 0 && !allowToday) diff = 7;
  return addDays(today, diff);
}

function resolveDayMonth(today: string, day: number, month: number | null, year: number | null): string | null {
  const [y, m] = today.split("-").map(Number);
  let yy = year ?? y;
  let mm = month ?? m;
  if (yy < 100) yy += 2000;
  const candidate = (yr: number, mo: number) => {
    const d = new Date(Date.UTC(yr, mo - 1, day));
    return d.getUTCMonth() === mo - 1 ? toDate(d) : null;
  };
  let res = candidate(yy, mm);
  if (!res) return null;
  if (res < today && year == null) {
    if (month == null) {
      mm += 1;
      if (mm > 12) { mm = 1; yy += 1; }
    } else yy += 1;
    res = candidate(yy, mm);
  }
  return res;
}

export function extract(segment: string, now: Now): Extracted {
  let s = ` ${segment} `;
  const today = now.date;
  const out: Extracted = {
    date: null, time: null, period: null, deadline: false, recurrence: "nessuna", priority: "normale",
    place: null, title: "", explicitDate: false, relative: null, notes: null,
  };
  const take = (re: RegExp, fn: (...m: string[]) => void) => {
    const m = re.exec(s);
    if (!m) return false;
    fn(...m);
    s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
    return true;
  };

  // Priorità
  take(/(?:\s(?:che\s+)?è)?\s(?:molto\s+)?(urgente|importante|importantissimo|priorità alta|assolutamente|non (?:devo )?dimenticare|da non dimenticare)\b/i, () => {
    out.priority = "alta";
  });

  // Ricorrenze
  take(new RegExp(`\\b(?:ogni|tutti i|tutte le)\\s+${WD}(?:\\s+(mattina|pomeriggio|sera)\\b)?`, "i"), (_, wd, p) => {
    out.recurrence = "settimanale";
    out.date = nextWeekday(today, wdIndex(wd), true);
    if (p) out.period = PERIODS[p.toLowerCase()];
  }) ||
    take(/\b(?:nei giorni feriali|tutti i giorni feriali|ogni giorno feriale|dal luned[iì] al venerd[iì]|nei giorni lavorativi)\b/i, () => {
      out.recurrence = "feriali";
    }) ||
    take(/\b(?:ogni|tutte le|tutti i)\s+(giorno|giorni|mattina|mattine|pomeriggio|pomeriggi|sera|sere|notte|notti)\b|\bquotidianamente\b|\bogni\s+santo\s+giorno\b/i, (_, w) => {
      out.recurrence = "giornaliera";
      if (w && /mattin/i.test(w)) out.period = PERIODS.mattina;
      else if (w && /pomerigg/i.test(w)) out.period = PERIODS.pomeriggio;
      else if (w && /ser/i.test(w)) out.period = PERIODS.sera;
      else if (w && /nott/i.test(w)) out.period = PERIODS.notte;
    }) ||
    take(/\b(?:ogni|tutte le)\s+settiman[ae]\b|\bsettimanalmente\b/i, () => {
      out.recurrence = "settimanale";
    }) ||
    take(/\b(?:il|ogni)\s+(\d{1,2})\s+(?:di\s+)?ogni\s+mese\b|\b(?:ogni|tutti i)\s+mes[ei]\b|\bmensilmente\b|\bogni\s+(\d{1,2})\s+del\s+mese\b/i, (_, d1, d2) => {
      out.recurrence = "mensile";
      const day = Number(d1 || d2);
      if (day) out.date = resolveDayMonth(today, day, null, null);
    });

  // Scadenza
  take(/\b(?:entro|prima di|prima del|prima della|non oltre)\b/i, () => {
    out.deadline = true;
  });
  if (/\b(?:scade|scadono|scadenza)\b/i.test(s)) out.deadline = true;

  // Tempo relativo: "tra 20 minuti", "tra 2 ore", "tra mezz'ora", "tra 3 giorni"
  take(/\b(?:tra|fra)\s+(\d+|un|una|mezz)['’]?\s*(minut[oi]|or[ae]|giorn[oi]|settiman[ae]|mes[ei])\b/i, (_, n, unit) => {
    const k = /^\d+$/.test(n) ? Number(n) : 1;
    const u = unit.toLowerCase();
    if (u.startsWith("minut")) out.relative = addMinutes(`${today}T${now.time}`, k);
    else if (u.startsWith("or")) out.relative = addMinutes(`${today}T${now.time}`, n.toLowerCase().startsWith("mezz") ? 30 : 60 * k);
    else if (u.startsWith("giorn")) out.date = addDays(today, k);
    else if (u.startsWith("settiman")) out.date = addDays(today, 7 * k);
    else out.date = addMonths(today, k);
    if (out.date) out.explicitDate = true;
  }) ||
    take(/\b(?:tra|fra)\s+mezz['’]?\s*ora\b/i, () => {
      out.relative = addMinutes(`${today}T${now.time}`, 30);
    });

  // Date esplicite: "il 20 ottobre", "20/10", "20/10/2026", "il 20"
  take(new RegExp(`\\b(?:(?:il|lo|l')\\s*)?(?:${WD}\\s+)?(\\d{1,2}|primo)\\s+(?:di\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?\\b`, "i"), (_, _wd, d, mo, y) => {
    out.date = resolveDayMonth(today, d.toLowerCase() === "primo" ? 1 : Number(d), MONTHS.indexOf(mo.toLowerCase()) + 1, y ? Number(y) : null);
    out.explicitDate = true;
  }) ||
    take(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/, (_, d, m, y) => {
      out.date = resolveDayMonth(today, Number(d), Number(m), y ? Number(y) : null);
      out.explicitDate = true;
    }) ||
    take(new RegExp(`\\b(?:il|${WD})\\s+(\\d{1,2})\\b(?!\\s*[:.]\\d)(?!\\s*(?:minut|or[ae]\\b|euro|km|metri|persone|pezzi|kg|litri))`, "i"), (_, _wd, d) => {
      out.date = resolveDayMonth(today, Number(d), null, null);
      out.explicitDate = true;
    });

  // Fine mese / settimana / anno, settimana prossima, mese prossimo
  take(/\b(?:(?:la\s+)?fine\s+(?:del\s+)?mese)\b/i, () => {
    const d = parseDate(today);
    out.date = toDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    out.explicitDate = true;
  }) ||
    take(/\b(?:(?:il|questo|nel)\s+)?(?:fine\s*settimana|weekend|week-end)\b/i, () => {
      out.date = nextWeekday(today, 6, true);
      out.explicitDate = true;
    }) ||
    take(/\b(?:(?:la\s+)?fine\s+(?:dell['’]\s*)?anno)\b/i, () => {
      out.date = `${today.slice(0, 4)}-12-31`;
      out.explicitDate = true;
    }) ||
    take(/\b(?:la\s+)?settimana\s+prossima\b|\b(?:la\s+)?prossima\s+settimana\b/i, () => {
      out.date = nextWeekday(today, 1, false);
      out.explicitDate = true;
    }) ||
    take(/\b(?:il\s+)?mese\s+prossimo\b|\b(?:il\s+)?prossimo\s+mese\b/i, () => {
      const d = parseDate(today);
      out.date = toDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
      out.explicitDate = true;
    });

  // Giorni della settimana
  if (out.recurrence === "nessuna" && !out.date) {
    take(new RegExp(`\\b(?:(?:il|la|questo|questa|prossimo|prossima)\\s+)?${WD}(\\s+prossim[oa]\\b)?`, "i"), (m, wd, next) => {
      const idx = wdIndex(wd);
      void m;
      void next;
      out.date = nextWeekday(today, idx, false);
      out.explicitDate = true;
    });
  }

  // Oggi, domani, stasera...
  take(/\b(dopodomani|domattina|domani|stamattina|stamani|stasera|stanotte|oggi)\b(?:\s+(?:in\s+)?(mattinata|mattina|pomeriggio|sera|notte))?/i, (_, w, p) => {
    const word = w.toLowerCase();
    if (!out.date || word.startsWith("dopodomani") || word.startsWith("dom")) {
      if (word === "dopodomani") out.date = addDays(today, 2);
      else if (word.startsWith("dom")) out.date = addDays(today, 1);
      else out.date = today;
      out.explicitDate = true;
    }
    if (word === "domattina" || word === "stamattina" || word === "stamani") out.period = PERIODS.mattina;
    if (word === "stasera") out.period = PERIODS.sera;
    if (word === "stanotte") out.period = PERIODS.notte;
    if (p) out.period = PERIODS[p.toLowerCase().replace("mattinata", "mattina")];
  });

  // Ora
  const setTime = (h: number, m: number) => {
    if (h > 23 || m > 59) return;
    out.time = `${pad(h)}:${pad(m)}`;
  };
  take(/\b(?:a\s+)?mezzogiorno\b/i, () => setTime(12, 0)) ||
    take(/\b(?:a\s+)?mezzanotte\b/i, () => setTime(23, 59)) ||
    take(
      /\b(?:(?:alle|all['’]|per le|verso le|entro le|dalle|dopo le|prima delle|ore|le|h)\s*)(\d{1,2})(?:\s*[:.]\s*(\d{2})|\s+e\s+(mezza|mezzo|un quarto|\d{1,2})|\s+meno\s+(un quarto|\d{1,2}))?(?:\s+(?:di|del|della)\s+(mattina|mattino|pomeriggio|sera|notte))?\b/i,
      (_, hh, mm, plus, minus, period) => {
        let h = Number(hh);
        let m = mm ? Number(mm) : 0;
        if (plus) m = /mezz/i.test(plus) ? 30 : /quarto/i.test(plus) ? 15 : Number(plus);
        if (minus) {
          h -= 1;
          m = 60 - (/quarto/i.test(minus) ? 15 : Number(minus));
        }
        const p = period?.toLowerCase();
        if (p && /pomeriggio|sera/.test(p) && h < 12) h += 12;
        else if (p === "notte" && h < 5) h += 0;
        else if (!p && h >= 1 && h <= 11 && EVENING_RE.test(segment)) h += 12;
        else if (!p && h >= 1 && h <= 6 && !MORNING_RE.test(segment)) h += 12; // "alle 3" = 15:00
        setTime(h, m);
      },
    ) ||
    take(/\b(\d{1,2}):(\d{2})\b/, (_, hh, mm) => setTime(Number(hh), Number(mm)));

  // Fasce della giornata rimaste ("in mattinata", "nel pomeriggio", "di sera")
  take(/\b(?:in|di|nel|nella|la|il|questo|questa|domani)\s+(mattinata|mattina|pomeriggio|sera|serata|notte)\b/i, (_, p) => {
    const k = p.toLowerCase().replace("mattinata", "mattina").replace("serata", "sera");
    out.period = PERIODS[k];
  });

  // Luogo
  const addr = ADDRESS_RE.exec(s);
  if (addr) {
    let q = clean(`${addr[1]} ${addr[2]}${addr[3] ? " " + addr[3].replace(/[,\s]/g, "") : ""}`);
    const after = s.slice(addr.index + addr[0].length);
    const city = CITY_RE.exec(after);
    let end = addr.index + addr[0].length;
    if (city && after.slice(0, city.index).trim() === "") {
      q += `, ${city[1]}`;
      end += city.index + city[0].length;
    }
    out.place = q;
    // Il titolo resta "Dentista", l'indirizzo va nelle note (se rimane qualcosa di sensato)
    const before = s.slice(0, addr.index).replace(/\s+(?:in|a|al|alla|allo|presso)\s*$/i, " ");
    const without = makeTitle(before + " " + s.slice(end));
    if (tokens(without).length) {
      s = before + " " + s.slice(end);
      out.notes = q.charAt(0).toUpperCase() + q.slice(1);
    }
  } else {
    const p = PLACE_RE.exec(s);
    if (p) out.place = p[1].toLowerCase();
  }

  out.title = makeTitle(s);
  return out;
}

// ---------------------------------------------------------------------------
// Calcolo di scadenze e notifiche

function categoryOf(text: string): NewReminder["category"] {
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(text)) return cat;
  return "altro";
}

export function buildReminder(e: Extracted, now: Now, context: { date: string | null }): NewReminder | null {
  if (!e.title || e.title.length < 2) return null;
  const nowLocal = `${now.date}T${now.time}`;
  let date = e.date ?? (e.explicitDate ? null : context.date);
  let time = e.time;
  let remind: string | null = null;
  let kind: NewReminder["kind"] = "cosa_da_fare";
  let recurrence = e.recurrence;
  const hasPlace = !!e.place;

  if (e.relative) {
    remind = e.relative;
    date = e.relative.slice(0, 10);
    time = e.relative.slice(11);
  } else if (recurrence !== "nessuna") {
    const t = time ?? e.period ?? "09:00";
    date = date ?? now.date;
    if (recurrence === "feriali") while ([0, 6].includes(weekdayOf(date))) date = addDays(date, 1);
    remind = `${date}T${t}`;
    if (remind <= nowLocal) {
      const step = { giornaliera: 1, feriali: 1, settimanale: 7, mensile: 0 }[recurrence];
      do {
        date = recurrence === "mensile" ? addMonths(date, 1) : addDays(date, step);
        if (recurrence === "feriali") while ([0, 6].includes(weekdayOf(date))) date = addDays(date, 1);
        remind = `${date}T${t}`;
      } while (remind <= nowLocal);
    }
    time = time ?? null;
  } else if (e.deadline) {
    kind = "scadenza";
    date = date ?? now.date;
    remind = `${addDays(date, -1)}T09:00`;
    if (remind <= nowLocal) remind = time ? addMinutes(`${date}T${time}`, -60) : `${date}T09:00`;
    if (remind <= nowLocal) remind = soon(now, 5);
  } else if (time) {
    if (!date) date = `${now.date}T${time}` > nowLocal ? now.date : addDays(now.date, 1);
    const isAppointment = APPOINTMENT_RE.test(e.title) || hasPlace;
    if (isAppointment) {
      kind = "appuntamento";
      remind = addMinutes(`${date}T${time}`, hasPlace ? -60 : -30);
      if (remind <= nowLocal) remind = `${date}T${time}` > nowLocal ? soon(now, 1) : `${date}T${time}`;
    } else remind = `${date}T${time}`;
  } else if (date || e.period) {
    date = date ?? now.date;
    remind = `${date}T${e.period ?? "09:00"}`;
    if (remind <= nowLocal) remind = date === now.date ? soon(now, 30) : remind;
  }

  if (kind === "cosa_da_fare" && hasPlace) kind = "luogo";
  if (kind === "cosa_da_fare" && APPOINTMENT_RE.test(e.title) && time) kind = "appuntamento";
  const priority = e.priority === "normale" && kind === "scadenza" && /\b(pagar|bollo|tass|multa|document|bollett|f24|imu|tari|rata)/i.test(e.title) ? "alta" : e.priority;

  return {
    title: e.title,
    notes: e.notes,
    category: categoryOf(`${e.title} ${e.place ?? ""}`),
    priority,
    kind,
    due_date: date ?? null,
    due_time: time ?? null,
    remind_at: remind,
    recurrence,
    place_query: e.place,
  };
}

// ---------------------------------------------------------------------------
// Suddivisione in più promemoria

export function splitSegments(text: string): string[] {
  let parts = text
    .split(/\s*(?:[;\n]|,|\.\s|:\s|\s(?:e poi|poi|e anche|inoltre|dopodiché|dopodiche|e infine|infine|oppure)\s)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  // Elenco "a, b e c": separa anche l'ultima "e"
  if (parts.length >= 2) {
    const last = parts.pop()!;
    parts.push(...last.split(/\s+e\s+(?=(?:poi\s+)?(?:\w+are|\w+ere|\w+ire|chiamare|comprare|andare|passare|fare|prendere|ritirare|pagare|portare|il|la|lo|i|gli|le|un|una)\b)/i));
  }
  // "comprare il pane e andare in posta": due verbi all'infinito
  parts = parts.flatMap((p) => p.split(/\s+e\s+(?=(?:\w+(?:are|ere|ire))\b(?!\s+(?:di|da)\b))/i));
  return parts.filter((p) => p.trim());
}

// ---------------------------------------------------------------------------
// Domande, completamenti, eliminazioni

const stem = (w: string) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 5);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/[\s']+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);

export function bestMatch(text: string, open: OpenReminder[]): OpenReminder | null {
  const q = new Set(tokens(text));
  if (!q.size) return null;
  let best: OpenReminder | null = null;
  let bestScore = 0;
  for (const r of open) {
    const t = tokens(`${r.title} ${r.place_name ?? ""}`);
    if (!t.length) continue;
    const shared = t.filter((w) => q.has(w)).length;
    const score = shared / Math.min(t.length, q.size) + shared * 0.01;
    if (shared > 0 && score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

function refDate(r: OpenReminder) {
  return r.due_date ?? r.remind_at?.slice(0, 10) ?? null;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function describeWhen(r: { due_date: string | null; due_time: string | null; remind_at: string | null; recurrence: string; kind: string }, now: Now): string {
  const date = r.due_date ?? r.remind_at?.slice(0, 10) ?? null;
  const time = r.due_time;
  const rec = { giornaliera: "ogni giorno", feriali: "nei giorni feriali", settimanale: "ogni settimana", mensile: "ogni mese" }[r.recurrence];
  const at = (t: string | null) => (t ? ` alle ${t.replace(/^0(\d)/, "$1").replace(":00", "")}` : "");
  if (rec) {
    const t = time ?? r.remind_at?.slice(11) ?? null;
    if (r.recurrence === "settimanale" && date) return `ogni ${WEEKDAY_NAMES[weekdayOf(date)]}${at(t)}`;
    return `${rec}${at(t)}`;
  }
  if (!date) return "";
  let day: string;
  if (date === now.date) day = "oggi";
  else if (date === addDays(now.date, 1)) day = "domani";
  else if (date === addDays(now.date, 2)) day = "dopodomani";
  else {
    const d = parseDate(date);
    day = date <= addDays(now.date, 6) ? WEEKDAY_NAMES[d.getUTCDay()] : `${WEEKDAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
  if (r.kind === "scadenza") return `entro ${day === "oggi" || day === "domani" || day === "dopodomani" ? day : day.replace(/^\w+ /, "il ")}${at(time)}`;
  return `${day}${at(time ?? (r.remind_at && r.remind_at.slice(0, 10) === date && r.remind_at.slice(11) !== "09:00" ? r.remind_at.slice(11) : null))}`;
}

const QUERY_RE =
  /^(?:(?:che\s+)?cosa\s+(?:devo|ho|c['’]è|c'e)|che\s+(?:impegni|cose|programmi|promemoria)|quali\s+(?:sono|impegni|promemoria|cose)|(?:dimmi|leggimi|elenca(?:mi)?|ripetimi)\b|cos['’]?\s*ho|cosa\s+mi\s+(?:aspetta|resta|manca)|ho\s+(?:impegni|qualcosa|cose)\b)/i;
const COMPLETE_RE =
  /^(?:(?:ok\s+)?(?:ho\s+(?:già\s+)?|l'ho\s+)(?=fatt|finit|complet|comprat|pres|chiamat|telefonat|pagat|ritirat|consegnat|mandat|spedit|portat|sentit|scritt|prenotat|lavat|pulit|stes|stirat|risolt|inviat|buttat|passat|andat)|(?:segna(?:lo|la)?|metti)\s+(?:come\s+)?(?:fatt[oa]|complet[oa])\s*:?\s*|(?:completa|spunta|fatto|finito)\s+)/i;
const DELETE_RE = /^(?:cancella(?:mi)?|elimina|togli|rimuovi|annulla|non\s+(?:devo|serve)\s+più)\s+(?:il\s+promemoria\s+(?:di|per)?\s*)?/i;

function answerQuery(text: string, open: OpenReminder[], now: Now): string {
  let from = now.date;
  let to = now.date;
  let label = "Oggi";
  if (/dopodomani/i.test(text)) { from = to = addDays(now.date, 2); label = "Dopodomani"; }
  else if (/domani/i.test(text)) { from = to = addDays(now.date, 1); label = "Domani"; }
  else if (/settimana/i.test(text)) { to = addDays(now.date, 6); label = "Nei prossimi 7 giorni"; }
  else if (/(tutt|lista|elenco|in sospeso|da fare\s*\??$)/i.test(text) && !/oggi/i.test(text)) { from = "0000"; to = "9999"; label = "In tutto"; }
  else {
    const wd = new RegExp(WD, "i").exec(text);
    if (wd) { from = to = nextWeekday(now.date, wdIndex(wd[1]), true); label = `${WEEKDAY_NAMES[weekdayOf(from)][0].toUpperCase()}${WEEKDAY_NAMES[weekdayOf(from)].slice(1)}`; }
  }
  const items = open.filter((r) => {
    const d = refDate(r);
    if (from === "0000") return true;
    if (!d) return false;
    return (from === now.date ? d <= to : d >= from && d <= to);
  });
  if (!items.length) return `${label} non hai niente in programma.`;
  const names = items.slice(0, 8).map((r) => {
    const t = r.due_time ? ` alle ${r.due_time.replace(/^0/, "").replace(":00", "")}` : "";
    const late = refDate(r)! < now.date && from !== "0000" ? " (in ritardo)" : "";
    return `${r.title}${t}${late}`;
  });
  const more = items.length > 8 ? ` e altre ${items.length - 8}` : "";
  return `${label} hai ${items.length === 1 ? "una cosa" : `${items.length} cose`}: ${joinList(names)}${more}.`;
}

// ---------------------------------------------------------------------------
// Punto d'ingresso

export function interpret(text: string, now: Now, open: OpenReminder[]): VoiceResult {
  const norm = normalizeText(text).trim();
  const result: VoiceResult = { create: [], complete_ids: [], delete_ids: [], reply: "" };
  if (!norm) return { ...result, reply: "Non ho sentito nulla, riprova." };

  if (QUERY_RE.test(norm) || (/\?\s*$/.test(norm) && /\b(cosa|che|quali|quando|ho)\b/i.test(norm))) {
    return { ...result, reply: answerQuery(norm, open, now) };
  }

  const del = DELETE_RE.exec(norm);
  const done = !del && COMPLETE_RE.exec(norm);
  if (del || done) {
    const rest = norm.slice((del || (done as RegExpExecArray))[0].length);
    const pieces = rest.split(/\s*(?:,|\s+e\s+(?:ho\s+)?)\s*/i).filter(Boolean);
    const remaining = [...open];
    const found: OpenReminder[] = [];
    for (const p of pieces.length ? pieces : [rest]) {
      const m = bestMatch(done ? `${p} ${rest.split(" ")[0]}` : p, remaining) ?? bestMatch(p, remaining);
      if (m) {
        found.push(m);
        remaining.splice(remaining.indexOf(m), 1);
      }
    }
    if (!found.length) {
      return { ...result, reply: `Non ho trovato nessun promemoria che corrisponda a "${clean(rest)}".` };
    }
    const titles = joinList(found.map((f) => f.title));
    if (del) return { ...result, delete_ids: found.map((f) => f.id), reply: `Ho eliminato: ${titles}.` };
    return { ...result, complete_ids: found.map((f) => f.id), reply: `Ottimo, ho segnato come fatto: ${titles}.` };
  }

  // Creazione
  const ctx: { date: string | null } = { date: null };
  let lastVerb: string | null = null;
  for (const seg of splitSegments(norm)) {
    const e = extract(seg, now);
    // "fare la spesa, la lavatrice" -> "Fare la lavatrice"
    const verb = /^(\p{L}+(?:are|ere|ire))\b/u.exec(e.title)?.[1] ?? null;
    if (verb) lastVerb = verb;
    else if (lastVerb && /^(?:il|lo|la|l'|i|gli|le|un|una|uno)\b/i.test(e.title)) {
      e.title = `${lastVerb[0].toUpperCase()}${lastVerb.slice(1).toLowerCase()} ${e.title[0].toLowerCase()}${e.title.slice(1)}`;
    }
    if (!e.title || /^(?:fare|cose|cose da fare|da fare|le seguenti cose|queste cose|tutto)$/i.test(e.title)) {
      if (e.date) ctx.date = e.date; // "oggi devo fare: ..." -> contesto per i segmenti successivi
      continue;
    }
    const r = buildReminder(e, now, ctx);
    if (!r) continue;
    if (e.date && !ctx.date) ctx.date = e.date;
    result.create.push(r);
  }

  if (!result.create.length) return { ...result, reply: "Non ho capito cosa devo ricordarti, puoi ripetere?" };
  const descr = result.create.map((r) => {
    const w = describeWhen(r, now);
    return w ? `${r.title} ${w}` : r.title;
  });
  result.reply =
    result.create.length === 1 ? `Ok, ti ricorderò: ${descr[0]}.` : `Ok, ho aggiunto ${result.create.length} promemoria: ${joinList(descr)}.`;
  return result;
}
