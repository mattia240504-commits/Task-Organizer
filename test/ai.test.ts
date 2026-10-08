import { describe, expect, it } from "vitest";
import { aiInterpret, sanitize } from "../src/ai";

const now = { date: "2026-10-08", time: "12:00", weekday: "giovedì" };
const open = [{ id: "a1", title: "Dentista", due_date: "2026-10-09", due_time: "10:00", remind_at: "2026-10-09T09:30", recurrence: "nessuna", place_name: null }];
const fakeAi = (response: unknown) => ({ run: async () => ({ response }) }) as unknown as Ai;

describe("Workers AI", () => {
  it("accetta e ripulisce una risposta valida", async () => {
    const r = await aiInterpret(
      fakeAi({
        create: [{ title: "comprare il pane", notes: "", category: "spesa", priority: "boh", kind: "cosa_da_fare", due_date: "2026-10-09", due_time: "", remind_at: "2026-10-09T09:00", recurrence: "nessuna", place_query: "" }],
        update: [{ id: "a1", title: "", due_date: "2026-10-15", due_time: "11:00", remind_at: "2026-10-15T10:30", recurrence: "" }, { id: "inventato", title: "x", due_date: "", due_time: "", remind_at: "", recurrence: "" }],
        complete_ids: ["inventato"],
        delete_ids: [],
        question: "",
        reply: "Fatto",
      }),
      "domani comprare il pane e sposta il dentista a giovedì alle 11",
      now,
      "Europe/Rome",
      open,
    );
    expect(r).toMatchObject({
      create: [{ title: "Comprare il pane", priority: "normale", due_date: "2026-10-09", due_time: null, place_query: null }],
      update: [{ id: "a1", due_date: "2026-10-15", due_time: "11:00", remind_at: "2026-10-15T10:30" }],
      complete_ids: [],
      question: null,
    });
    expect(r!.update).toHaveLength(1);
  });

  it("legge il JSON anche se arriva come testo", async () => {
    const r = await aiInterpret(fakeAi('Ecco: {"create":[],"update":[],"complete_ids":["a1"],"delete_ids":[],"question":"","reply":"ok"}'), "ho fatto il dentista", now, "Europe/Rome", open);
    expect(r?.complete_ids).toEqual(["a1"]);
  });

  it("restituisce null se l'IA non risponde o risponde male (si useranno le regole)", async () => {
    const broken = { run: async () => { throw new Error("4006: daily free allocation exceeded"); } } as unknown as Ai;
    expect(await aiInterpret(broken, "x", now, "Europe/Rome", open)).toBeNull();
    expect(await aiInterpret(undefined, "x", now, "Europe/Rome", open)).toBeNull();
    expect(await aiInterpret(fakeAi("non è json"), "x", now, "Europe/Rome", open)).toBeNull();
    expect(sanitize({ foo: 1 }, open)).toBeNull();
  });

  it("dopo una risposta non fa altre domande", async () => {
    const r = await aiInterpret(
      fakeAi({ create: [], update: [], complete_ids: [], delete_ids: [], question: "Ancora?", reply: "" }),
      "alle 7 palestra",
      now,
      "Europe/Rome",
      open,
      { question: "Di mattina o di sera?", answer: "sera" },
    );
    expect(r?.question).toBeNull();
  });
});
