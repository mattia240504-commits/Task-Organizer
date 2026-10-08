import { describe, expect, it } from "vitest";
import { applyAnswer, interpret, type OpenReminder } from "../src/parser";

const now = { date: "2026-10-08", time: "12:00" }; // giovedì
const open: OpenReminder[] = [
  { id: "1", title: "Comprare il latte", due_date: "2026-10-08", due_time: null, remind_at: "2026-10-08T09:00", recurrence: "nessuna", place_name: null },
  { id: "2", title: "Chiamare la mamma", due_date: "2026-10-09", due_time: "18:00", remind_at: "2026-10-09T18:00", recurrence: "nessuna", place_name: null },
  { id: "3", title: "Fare la spesa", due_date: null, due_time: null, remind_at: null, recurrence: "nessuna", place_name: null },
];
const one = (text: string) => {
  const r = interpret(text, now, open);
  expect(r.create).toHaveLength(1);
  return r.create[0];
};

describe("creazione", () => {
  it("toglie le formule iniziali e capisce 'domani'", () => {
    expect(one("Ehi Claude ricordami domani di andare in posta")).toMatchObject({
      title: "Andare in posta", due_date: "2026-10-09", remind_at: "2026-10-09T09:00", kind: "luogo", place_query: "posta",
    });
  });

  it("divide più cose e porta la data ai segmenti successivi", () => {
    const r = interpret(
      "domani alle 10 dentista in via Torino 12 a Milano, poi passare in farmacia e pagare il bollo entro fine mese",
      now,
      open,
    );
    expect(r.create.map((c) => c.title)).toEqual(["Dentista", "Passare in farmacia", "Pagare il bollo"]);
    expect(r.create[0]).toMatchObject({
      kind: "appuntamento", due_date: "2026-10-09", due_time: "10:00", remind_at: "2026-10-09T09:00",
      place_query: "via Torino 12, Milano", notes: "Via Torino 12, Milano",
    });
    expect(r.create[1]).toMatchObject({ due_date: "2026-10-09", place_query: "farmacia" });
    expect(r.create[2]).toMatchObject({ kind: "scadenza", due_date: "2026-10-31", remind_at: "2026-10-30T09:00", priority: "alta" });
    expect(r.reply).toContain("3 promemoria");
  });

  it("elenco 'oggi devo fare a, b e c' con verbo condiviso", () => {
    const r = interpret("oggi devo fare la spesa, la lavatrice e rispondere a Luca", now, open);
    expect(r.create.map((c) => c.title)).toEqual(["Fare la spesa", "Fare la lavatrice", "Rispondere a Luca"]);
    expect(r.create.every((c) => c.due_date === "2026-10-08" && c.remind_at === "2026-10-08T12:30")).toBe(true);
  });

  it("giorni della settimana con accento e indirizzi", () => {
    expect(one("venerdì alle 18 aperitivo da Marco in corso Como")).toMatchObject({
      title: "Aperitivo da Marco", due_date: "2026-10-09", due_time: "18:00", remind_at: "2026-10-09T17:00", place_query: "corso Como",
    });
    expect(one("martedì visita dal medico")).toMatchObject({ due_date: "2026-10-13", kind: "luogo" });
  });

  it("scadenze", () => {
    expect(one("entro il 20 devo consegnare il modulo ISEE")).toMatchObject({
      title: "Consegnare il modulo ISEE", kind: "scadenza", due_date: "2026-10-20", remind_at: "2026-10-19T09:00",
    });
    expect(one("15/11 scade l'assicurazione")).toMatchObject({ title: "Scade l'assicurazione", kind: "scadenza", due_date: "2026-11-15" });
  });

  it("ricorrenze", () => {
    expect(one("ogni mattina alle 8 prendere la vitamina")).toMatchObject({
      title: "Prendere la vitamina", recurrence: "giornaliera", remind_at: "2026-10-09T08:00",
    });
    expect(one("ogni lunedì portare fuori la differenziata")).toMatchObject({ recurrence: "settimanale", remind_at: "2026-10-12T09:00" });
    expect(one("nei giorni feriali alle 7 e un quarto sveglia per la palestra")).toMatchObject({
      title: "Sveglia per la palestra", recurrence: "feriali", remind_at: "2026-10-09T07:15",
    });
    expect(one("il 5 di ogni mese pagare l'affitto")).toMatchObject({ recurrence: "mensile", remind_at: "2026-11-05T09:00" });
  });

  it("orari e tempi relativi", () => {
    expect(one("ricordami tra 20 minuti di togliere la pasta")).toMatchObject({ title: "Togliere la pasta", remind_at: "2026-10-08T12:20" });
    expect(one("fra 2 ore stendere i panni").remind_at).toBe("2026-10-08T14:00");
    expect(one("stasera chiamare Giulia").remind_at).toBe("2026-10-08T19:00");
    expect(one("alle 3 e mezza riunione con il cliente")).toMatchObject({ due_time: "15:30", remind_at: "2026-10-08T15:00", kind: "appuntamento" });
    expect(one("alle 9 colazione con Anna")).toMatchObject({ due_date: "2026-10-09", due_time: "09:00" }); // le 9 sono passate: domani
    expect(one("domani pomeriggio passare dal meccanico").remind_at).toBe("2026-10-09T15:00");
    expect(one("il 25 dicembre comprare i regali").due_date).toBe("2026-12-25");
    expect(one("la settimana prossima prenotare la revisione").due_date).toBe("2026-10-12");
  });

  it("priorità e cose senza data", () => {
    expect(one("dopodomani mattina ritirare la giacca in lavanderia è urgente")).toMatchObject({
      title: "Ritirare la giacca in lavanderia", priority: "alta", due_date: "2026-10-10",
    });
    expect(one("chiamare l'idraulico")).toMatchObject({ remind_at: null, due_date: null, category: "casa" });
    expect(interpret("comprare il pane e andare in banca", now, open).create.map((c) => c.title)).toEqual([
      "Comprare il pane",
      "Andare in banca",
    ]);
  });
});

describe("domande, completamenti, eliminazioni", () => {
  it("risponde alle domande senza creare nulla", () => {
    expect(interpret("cosa devo fare oggi?", now, open)).toMatchObject({ create: [], reply: "Oggi hai una cosa: Comprare il latte." });
    expect(interpret("che impegni ho domani", now, open).reply).toBe("Domani hai una cosa: Chiamare la mamma alle 18.");
  });

  it("segna come fatto con verbi coniugati", () => {
    expect(interpret("ho comprato il latte", now, open).complete_ids).toEqual(["1"]);
    expect(interpret("ho fatto la spesa e ho chiamato la mamma", now, open).complete_ids).toEqual(["3", "2"]);
  });

  it("elimina", () => {
    expect(interpret("cancella chiamare la mamma", now, open).delete_ids).toEqual(["2"]);
    expect(interpret("elimina il dentista", now, open)).toMatchObject({ delete_ids: [], reply: expect.stringContaining("Non ho trovato") });
  });
});

describe("modifiche a voce", () => {
  const list: OpenReminder[] = [
    { id: "d", title: "Dentista", due_date: "2026-10-09", due_time: "10:00", remind_at: "2026-10-09T09:30", recurrence: "nessuna", place_name: null, kind: "appuntamento", created_at: 5 },
    ...open.map((o, i) => ({ ...o, created_at: i })),
  ];
  it("sposta, rimanda, anticipa", () => {
    expect(interpret("sposta il dentista a giovedì alle 11", now, list).update).toEqual([
      { id: "d", due_date: "2026-10-15", due_time: "11:00", remind_at: "2026-10-15T10:30", recurrence: "nessuna" },
    ]);
    expect(interpret("rimanda la spesa a domani", now, list).update[0]).toMatchObject({ id: "3", due_date: "2026-10-09" });
    expect(interpret("anticipa il dentista di un'ora", now, list).update[0]).toMatchObject({ due_time: "09:00" });
    expect(interpret("sposta il dentista dalle 10 alle 15", now, list).update[0]).toMatchObject({ due_time: "15:00" });
  });
  it("rinomina e annulla l'ultimo", () => {
    expect(interpret("rinomina la spesa in spesa all'Esselunga", now, list).update).toEqual([{ id: "3", title: "Spesa all'Esselunga" }]);
    expect(interpret("annulla l'ultimo", now, list).delete_ids).toEqual(["d"]);
  });
});

describe("domande e risposte", () => {
  it("chiede se l'ora è ambigua e applica la risposta", () => {
    const p = interpret("domani alle 7 palestra", now, open);
    expect(p.question).toBe("Palestra alle 7: di mattina o di sera?");
    expect(applyAnswer(p, "di sera", now, open).create[0]).toMatchObject({ due_time: "19:00" });
    expect(applyAnswer(p, "sì", now, open).create[0].due_time).toBe("07:00");
    expect(applyAnswer(p, "no, alle 8", now, open).create[0].due_time).toBe("08:00");
    expect(applyAnswer(p, "no", now, open).create).toEqual([]);
    expect(applyAnswer(p, "no, venerdì alle 18 calcetto", now, open).create[0]).toMatchObject({ title: "Calcetto", due_time: "18:00" });
  });
  it("non chiede se il contesto è chiaro", () => {
    expect(interpret("domani alle 7 cena da Marco", now, open)).toMatchObject({ question: null, create: [{ due_time: "19:00" }] });
    expect(interpret("domani alle 7 sveglia per la palestra", now, open).question).toBeNull();
  });
  it("chiede conferma per frasi vaghe", () => {
    expect(interpret("blabla", now, open).question).toContain("Va bene così");
  });
});
