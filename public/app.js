// Web app dei promemoria: lista, dettatura vocale, distanze dal luogo attuale e notifiche push.

const $ = (sel) => document.querySelector(sel);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

let token = store.get("token");
let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";
let here = null; // { lat, lon } posizione attuale
let reminders = [];

// ---------- API ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    logout("Codice di accesso non valido.");
    throw new Error("unauthorized");
  }
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

// ---------- Date ----------
const pad = (n) => String(n).padStart(2, "0");
function localNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayFmt = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const longDayFmt = new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const fmtDay = (date) => dayFmt.format(new Date(`${date}T00:00:00Z`));

const RECURRENCE = { giornaliera: "ogni giorno", feriali: "giorni feriali", settimanale: "ogni settimana", mensile: "ogni mese" };
const KIND = { appuntamento: "appuntamento", scadenza: "scadenza", luogo: "da raggiungere" };

function refDate(r) {
  return r.due_date || (r.remind_at ? r.remind_at.slice(0, 10) : null);
}

// ---------- Distanze ----------
function haversine(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);
const fmtMin = (min) => (min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`);

function placeLabel(r) {
  if (r.place_lat == null) return r.place_query ? `📍 ${r.place_query}` : "";
  let dist = r.distance_m, walk = r.walk_min, drive = r.drive_min;
  if (here) {
    const straight = haversine(here, { lat: r.place_lat, lon: r.place_lon });
    dist = straight * 1.3;
    walk = (straight * 1.25) / 80;
    drive = null;
  }
  const bits = [`📍 ${r.place_name}`];
  if (dist != null) bits.push(fmtDist(dist));
  if (walk != null && walk <= 25) bits.push(`${fmtMin(walk)} a piedi`);
  else if (drive != null) bits.push(`${fmtMin(drive)} in auto`);
  return bits.join(" · ");
}

function locate() {
  if (!("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      render();
    },
    () => {},
    { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10000 },
  );
}

// ---------- Rendering ----------
function itemEl(r, { done = false } = {}) {
  const el = $("#item-tpl").content.firstElementChild.cloneNode(true);
  el.dataset.id = r.id;
  if (done) el.classList.add("done");
  el.querySelector(".title").textContent = r.title;

  const meta = [];
  const { date: today } = localNow();
  const ref = refDate(r);
  if (ref && ref < today && !done) meta.push(`<span class="late">${fmtDay(ref)}</span>`);
  else if (ref && ref > addDays(today, 1)) meta.push(fmtDay(ref));
  if (r.due_time) meta.push(r.due_time);
  if (r.remind_at && !r.notified && r.remind_at.slice(11) !== r.due_time) {
    const rd = r.remind_at.slice(0, 10);
    meta.push(`🔔 ${rd !== ref ? fmtDay(rd) + " " : ""}${r.remind_at.slice(11)}`);
  }
  if (RECURRENCE[r.recurrence]) meta.push(`↻ ${RECURRENCE[r.recurrence]}`);
  if (r.priority === "alta") meta.push(`<span class="high">‼ importante</span>`);
  const chips = [KIND[r.kind], r.category !== "altro" ? r.category : null].filter(Boolean)
    .map((c) => `<span class="chip">${c}</span>`).join("");
  el.querySelector(".meta").innerHTML = meta.join(" · ") + chips;
  el.querySelector(".notes").textContent = r.notes || "";

  const place = el.querySelector(".place");
  place.textContent = placeLabel(r);
  if (r.place_lat != null) {
    place.href = `https://maps.apple.com/?daddr=${r.place_lat},${r.place_lon}&q=${encodeURIComponent(r.place_name || r.title)}`;
  } else place.removeAttribute("href");

  el.querySelector(".check-btn").addEventListener("click", () => toggleDone(r, el, done));
  el.querySelector(".del-btn").addEventListener("click", () => remove(r, el));
  return el;
}

function render() {
  const list = $("#list");
  list.innerHTML = "";
  const { date: today } = localNow();
  const tomorrow = addDays(today, 1);
  const weekEnd = addDays(today, 7);
  $("#today-label").textContent = longDayFmt.format(new Date(`${today}T00:00:00Z`));

  const groups = [
    { key: "late", title: "In ritardo", test: (d) => d && d < today },
    { key: "today", title: "Oggi", test: (d) => d === today },
    { key: "tomorrow", title: "Domani", test: (d) => d === tomorrow },
    { key: "week", title: "Prossimi 7 giorni", test: (d) => d && d > tomorrow && d <= weekEnd },
    { key: "later", title: "Più avanti", test: (d) => d && d > weekEnd },
    { key: "nodate", title: "Senza data", test: (d) => !d },
  ];
  for (const g of groups) {
    const items = reminders.filter((r) => g.test(refDate(r)));
    if (!items.length) continue;
    items.sort((a, b) =>
      `${refDate(a) ?? ""}${a.due_time ?? a.remind_at?.slice(11) ?? "99"}`.localeCompare(`${refDate(b) ?? ""}${b.due_time ?? b.remind_at?.slice(11) ?? "99"}`),
    );
    const section = document.createElement("section");
    section.className = `group ${g.key}`;
    section.innerHTML = `<h2>${g.title} <small>${items.length}</small></h2><div class="cards"></div>`;
    for (const r of items) section.querySelector(".cards").append(itemEl(r));
    list.append(section);
  }
  $("#empty").hidden = reminders.length > 0;
}

async function load() {
  const data = await api("/api/reminders");
  reminders = data.reminders;
  if (data.timezone) timezone = data.timezone;
  render();
  if (!$("#done-list").hidden) loadDone();
}

async function loadDone() {
  const data = await api("/api/reminders?done=1");
  const box = $("#done-list");
  box.innerHTML = "";
  if (!data.reminders.length) {
    box.innerHTML = `<p class="empty" style="margin:16px 0">Nessun promemoria completato.</p>`;
    return;
  }
  const cards = document.createElement("div");
  cards.className = "cards";
  for (const r of data.reminders) cards.append(itemEl(r, { done: true }));
  box.append(cards);
}

async function toggleDone(r, el, wasDone) {
  el.classList.add("leaving");
  if (!wasDone) el.classList.add("done");
  try {
    await api(`/api/reminders/${r.id}`, { method: "PATCH", body: JSON.stringify({ done: !wasDone }) });
    setTimeout(load, 250);
  } catch (e) {
    el.classList.remove("leaving", "done");
    showBanner(`Non riesco a salvare: ${e.message}`);
  }
}

async function remove(r, el) {
  if (!confirm(`Eliminare "${r.title}"?`)) return;
  el.classList.add("leaving");
  await api(`/api/reminders/${r.id}`, { method: "DELETE" }).catch(() => {});
  load();
}

function showBanner(html) {
  const b = $("#banner");
  b.innerHTML = html;
  b.hidden = !html;
}

// ---------- Inserimento vocale / testo ----------
async function send(text) {
  text = text.trim();
  if (!text) return;
  const reply = $("#reply");
  reply.hidden = false;
  reply.classList.add("loading");
  $("#reply-heard").textContent = `“${text}”`;
  $("#reply-text").textContent = "Ci penso";
  $("#compose-input").value = "";
  try {
    const data = await api("/api/voice", {
      method: "POST",
      body: JSON.stringify({ text, timezone, ...(here || {}) }),
    });
    $("#reply-text").textContent = data.reply;
    speak(data.reply);
    await load();
  } catch (e) {
    $("#reply-text").textContent = `Errore: ${e.message}`;
  } finally {
    reply.classList.remove("loading");
  }
}

function speak(text) {
  if (store.get("speak") !== "1" || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "it-IT";
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;

function startListening() {
  if (!Recognition) {
    // Senza riconoscimento vocale nel browser: si usa il microfono della tastiera
    $("#compose-input").focus();
    showBanner("Usa il tasto 🎤 della tastiera per dettare, poi premi Invio.");
    setTimeout(() => showBanner(""), 5000);
    return;
  }
  if (recognizer) {
    recognizer.stop();
    return;
  }
  recognizer = new Recognition();
  recognizer.lang = "it-IT";
  recognizer.interimResults = true;
  recognizer.continuous = false;
  let finalText = "";
  const input = $("#compose-input");
  $("#mic-btn").classList.add("listening");
  recognizer.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText += t;
      else interim += t;
    }
    input.value = finalText + interim;
  };
  recognizer.onerror = (ev) => {
    if (ev.error === "not-allowed") showBanner("Consenti l'accesso al microfono nelle impostazioni del browser.");
  };
  recognizer.onend = () => {
    $("#mic-btn").classList.remove("listening");
    recognizer = null;
    const text = (finalText || input.value).trim();
    if (text) send(text);
  };
  recognizer.start();
}

// ---------- Notifiche push ----------
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function urlB64ToUint8Array(b64) {
  const s = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return isIOS && !isStandalone ? "install" : "unsupported";
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) return "on";
  return Notification.permission === "denied" ? "denied" : "off";
}

async function refreshPushUI() {
  const state = await pushState();
  const hint = {
    install: "Su iPhone le notifiche funzionano solo dall'app installata: tocca Condividi → \"Aggiungi alla schermata Home\", poi apri Promemoria da lì.",
    unsupported: "Questo browser non supporta le notifiche push.",
    denied: "Le notifiche sono bloccate: riattivale da Impostazioni → Notifiche → Promemoria.",
    off: "Ricevi un avviso all'ora di ogni promemoria e un riepilogo al mattino.",
    on: "Notifiche attive su questo dispositivo ✓",
  }[state];
  $("#push-hint").textContent = hint;
  $("#push-btn").textContent = state === "on" ? "Disattiva" : "Attiva notifiche";
  $("#push-btn").disabled = ["install", "unsupported", "denied"].includes(state);
  $("#push-test").disabled = state !== "on";
  if (state === "off" && !store.get("push-dismissed")) {
    showBanner(`Vuoi ricevere le notifiche dei promemoria?<br><button class="secondary" id="banner-push">Attiva notifiche</button>`);
    $("#banner-push").onclick = async () => { await togglePush(); showBanner(""); };
  } else if (state === "install" && !store.get("push-dismissed")) {
    showBanner(hint);
    store.set("push-dismissed", "1");
  }
  return state;
}

async function togglePush() {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await api("/api/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: existing.endpoint }) }).catch(() => {});
    await existing.unsubscribe();
    store.set("push-dismissed", "1");
    return refreshPushUI();
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return refreshPushUI();
  const { key } = await fetch("/api/vapid-public-key").then((r) => r.json());
  if (!key) {
    alert("Il server non ha le chiavi VAPID configurate (vedi README).");
    return;
  }
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key) });
  await api("/api/subscribe", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  return refreshPushUI();
}

// ---------- Impostazioni ----------
async function openSettings() {
  const dlg = $("#settings");
  $("#api-url").textContent = `${location.origin}/api/voice`;
  $("#tz-label").textContent = timezone;
  $("#speak-replies").checked = store.get("speak") === "1";
  try {
    const s = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
    timezone = s.timezone;
    $("#tz-label").textContent = timezone;
    $("#digest-off").checked = s.digest_time === "off";
    $("#digest-time").value = s.digest_time === "off" ? "08:00" : s.digest_time;
    $("#digest-time").disabled = s.digest_time === "off";
  } catch {}
  refreshPushUI();
  dlg.showModal();
}

async function saveDigest() {
  const off = $("#digest-off").checked;
  $("#digest-time").disabled = off;
  await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ digest_time: off ? "off" : $("#digest-time").value || "08:00" }),
  }).catch(() => {});
}

// ---------- Avvio ----------
function logout(message) {
  token = null;
  store.del("token");
  $("#app").hidden = true;
  $("#login").hidden = false;
  $("#settings").close?.();
  const err = $("#login-error");
  err.textContent = message || "";
  err.hidden = !message;
}

async function start() {
  $("#login").hidden = true;
  $("#app").hidden = false;
  locate();
  try {
    await load();
  } catch (e) {
    if (e.message !== "unauthorized") showBanner(`Non riesco a caricare i promemoria: ${e.message}`);
    return;
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").then(() => refreshPushUI()).catch(() => {});
  } else refreshPushUI();
}

$("#login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  token = $("#token-input").value.trim();
  store.set("token", token);
  start();
});
$("#compose-form").addEventListener("submit", (e) => {
  e.preventDefault();
  send($("#compose-input").value);
});
$("#mic-btn").addEventListener("click", startListening);
$("#settings-btn").addEventListener("click", openSettings);
$("#push-btn").addEventListener("click", () => togglePush().catch((e) => alert(e.message)));
$("#push-test").addEventListener("click", () => api("/api/test-push", { method: "POST" }).catch((e) => alert(e.message)));
$("#digest-time").addEventListener("change", saveDigest);
$("#digest-off").addEventListener("change", saveDigest);
$("#speak-replies").addEventListener("change", (e) => store.set("speak", e.target.checked ? "1" : "0"));
$("#logout-btn").addEventListener("click", () => logout());
$("#show-done").addEventListener("click", () => {
  const box = $("#done-list");
  box.hidden = !box.hidden;
  $("#show-done").textContent = box.hidden ? "Mostra completati" : "Nascondi completati";
  if (!box.hidden) loadDone();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && token) {
    locate();
    load().catch(() => {});
  }
});

// Il comando rapido o una notifica possono aprire l'app con ?token=... o ?text=...
const params = new URLSearchParams(location.search);
if (params.get("token")) {
  token = params.get("token");
  store.set("token", token);
}
if (token) {
  start().then(() => {
    if (params.get("text")) send(params.get("text"));
    if (params.has("token") || params.has("text")) history.replaceState(null, "", "/");
  });
} else logout();
