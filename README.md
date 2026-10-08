# Promemoria vocali con Siri

Detti i promemoria come faresti con Siri: **"Ehi Siri, nota promemoria"** → *"domani alle 10 dentista in via Torino 12, poi passare in farmacia e pagare il bollo entro fine mese"*.

L'app capisce la frase, la divide in promemoria separati, li riscrive in modo pulito, calcola date e orari e, se devi andare da qualche parte, trova il posto sulla mappa e ti dice **quanto è distante** da dove sei. Siri ti legge la conferma ad alta voce.

**È tutto gratuito, senza carta di credito.** Le frasi vengono capite dall'IA gratuita inclusa in Cloudflare (Workers AI, modello open source Llama). Se l'IA non è disponibile, o se finisce il limite gratuito giornaliero (circa un centinaio di frasi al giorno), entra in gioco automaticamente un interprete a regole scritto apposta per l'italiano (`src/parser.ts`). Senza carta Cloudflare non può addebitarti nulla: al massimo, oltre il limite, l'IA si ferma fino al giorno dopo.

**Se non è sicura, Siri ti chiede.** Esempi: *"Palestra alle 7: di mattina o di sera?"*, *"Intendi «Fare la spesa»?"*, *"Ho capito «Blabla», senza data: va bene o vuoi rispiegarmelo?"*. Rispondi *"sì"*, *"no"*, *"di sera"*, *"no, alle 11"* oppure ripeti la frase in un altro modo.

Poi ritrovi tutto nella **web app Promemoria** sulla schermata Home, dove puoi:

- vedere la lista divisa in *In ritardo / Oggi / Domani / Prossimi 7 giorni / Più avanti / Senza data*;
- vedere la distanza aggiornata di ogni luogo da dove ti trovi e aprire le indicazioni in Mappe;
- ricevere una **notifica** all'ora di ogni promemoria e un **riepilogo ogni mattina**;
- segnare le cose come fatte, eliminarle o scriverne di nuove (anche con il microfono 🎤);
- **toccare un promemoria per modificarlo**: titolo, note, giorno, ora, quando avvisarti, ripetizione, priorità e luogo.

Cosa puoi dire:

| Cosa dici | Cosa succede |
|---|---|
| "Ricordami domani di chiamare il commercialista" | Promemoria domani alle 9:00 |
| "Oggi devo fare la spesa, la lavatrice e rispondere a Luca" | 3 promemoria per oggi |
| "Venerdì alle 18 aperitivo da Marco in corso Como" | Appuntamento con avviso un'ora prima e distanza dal posto |
| "Entro il 20 devo consegnare il modulo ISEE" | Scadenza con avviso il giorno prima |
| "Ogni mattina alle 8 prendere la vitamina" | Promemoria giornaliero |
| "Ogni lunedì portare fuori la differenziata" | Promemoria settimanale |
| "Tra 20 minuti togliere la pasta" | Avviso tra 20 minuti |
| "Dopodomani ritirare la giacca in lavanderia, è urgente" | Priorità alta e lavanderia più vicina |
| "Ho comprato il latte" / "Ho fatto la spesa e ho chiamato la mamma" | Segna come fatti i promemoria corrispondenti |
| "Cancella chiamare la mamma" | Elimina il promemoria |
| "Sposta il dentista a giovedì alle 11" | Cambia data e ora (e ricalcola l'avviso) |
| "Rimanda la spesa a domani" / "Anticipa il dentista di un'ora" | Sposta il promemoria |
| "Rinomina la spesa in spesa all'Esselunga" | Cambia il titolo |
| "Annulla l'ultimo" | Toglie l'ultimo promemoria aggiunto |
| "Cosa devo fare oggi?" / "Che impegni ho domani?" | Siri ti legge l'elenco |

Riconosce oggi, domani, dopodomani, stasera, i giorni della settimana, date come "il 20", "25 dicembre" o "15/11", "tra N minuti/ore/giorni", "fine mese", "settimana prossima"; orari come "alle 10", "alle 3 e mezza" o "alle 7 meno un quarto"; ripetizioni come "ogni giorno", "ogni lunedì", "nei giorni feriali" o "il 5 di ogni mese"; e luoghi come farmacia, posta, banca, supermercato, medico, indirizzi tipo "via…", "piazza…" o "corso…".

Se qualcosa viene capito male, puoi correggerlo a voce ("sposta…", "rinomina…") oppure toccandolo nell'app.

---

## Come funziona

```
iPhone ── "Ehi Siri, nota promemoria" ──► Comando rapido
              (testo dettato + posizione)          │
                                                   ▼
                    Server su Cloudflare (gratis) ──► IA gratuita Workers AI (regole italiane di riserva)
                         │   database D1          ──► OpenStreetMap (luogo e distanza)
                         │
                         ├──► risposta letta da Siri
                         └──► ogni minuto controlla le scadenze ──► notifica push sull'iPhone
                                                                       ▲
             Web app "Promemoria" sulla schermata Home ────────────────┘
```

---

## Installazione passo passo

Ti servono un computer (Mac, Windows o Linux) con [Node.js](https://nodejs.org) 20 o più recente, e circa 20 minuti. **Non serve nessuna carta di credito.**

### 1. Strumenti sul computer

Installa **Node.js** (versione "LTS") da https://nodejs.org e **Git** da https://git-scm.com (sul Mac c'è già: se il terminale te lo chiede, accetta di installare gli "strumenti per sviluppatori").

### 2. Account Cloudflare (gratuito)

1. Registrati gratis su **https://dash.cloudflare.com/sign-up**.
2. Scarica questo progetto sul computer e apri il terminale nella sua cartella:
   ```bash
   git clone https://github.com/mattia240504-commits/Task-Organizer.git
   cd Task-Organizer
   npm install
   npx wrangler login        # si apre il browser: autorizza Cloudflare
   ```

### 3. Database

```bash
npx wrangler d1 create promemoria
```

Il comando stampa un `database_id`: copialo in `wrangler.toml` alla voce `database_id` (al posto di quello che c'è). Poi crea le tabelle:

```bash
npm run db:init
```

Se il tuo fuso orario non è quello italiano, cambia `TIMEZONE` in `wrangler.toml`. Anche così, l'app lo aggiorna da sola quando la apri.

### 4. Segreti

```bash
npm run vapid      # genera le chiavi per le notifiche e le stampa
```

Ora imposta i tre segreti. Ogni comando ti chiede il valore da incollare:

```bash
npx wrangler secret put APP_TOKEN            # una password lunga inventata da te (es. 30 caratteri a caso)
npx wrangler secret put VAPID_PUBLIC_KEY     # il valore stampato da npm run vapid
npx wrangler secret put VAPID_PRIVATE_KEY    # il valore stampato da npm run vapid
```

> `APP_TOKEN` è la password che protegge i tuoi promemoria: serve all'app e al comando rapido. Non condividerla.

### 5. Pubblica

```bash
npm run deploy
```

Alla fine vedrai un indirizzo del tipo `https://promemoria.TUONOME.workers.dev`. È il tuo server. Il comando applica anche eventuali nuove tabelle del database.

Se la prima volta ti chiede di registrare un sottodominio `workers.dev`, sceglilo dal sito di Cloudflare (Workers & Pages) e ripeti `npm run deploy`.

#### Aggiornamenti automatici (consigliato)

Così ogni modifica pubblicata su GitHub va online da sola, senza Terminale:

1. Su https://dash.cloudflare.com apri **Workers & Pages → promemoria → Settings → Build** (o "Builds").
2. **Connect** → **GitHub** → autorizza l'app Cloudflare sul repository `Task-Organizer`.
3. Imposta:
   - **Branch**: quello del progetto (es. `claude/voice-reminder-app-qh2llf`);
   - **Build command**: lascia vuoto;
   - **Deploy command**: `npm run deploy`;
   - **Root directory**: `/`.
4. **Save / Connect**. Parte subito una pubblicazione: la vedi nella scheda **Deployments**.

I segreti (`APP_TOKEN`, chiavi VAPID) restano quelli già impostati.

### 6. La web app sull'iPhone

1. Apri l'indirizzo in **Safari** sull'iPhone.
2. Tocca **Condividi** (il quadrato con la freccia) → **Aggiungi alla schermata Home**.
3. Apri **Promemoria** dalla schermata Home e inserisci il tuo `APP_TOKEN`.
4. Tocca **Attiva notifiche** e consenti. Su iPhone le notifiche funzionano solo dall'app aggiunta alla Home, con iOS 16.4 o successivo.
5. Consenti anche l'accesso alla **posizione**, che serve per le distanze.
6. Dalle impostazioni (⚙️) puoi provare una notifica e scegliere l'ora del riepilogo del mattino.

### 7. Il comando rapido per Siri

Apri l'app **Comandi** sull'iPhone → **+** (nuovo comando) e aggiungi queste azioni, nell'ordine:

1. **Detta testo**
   - Lingua: *Italiano*
   - Interrompi l'ascolto: *Dopo una pausa*
2. **Ottieni posizione attuale**
3. **Ottieni contenuti dell'URL**
   - URL: `https://promemoria.TUONOME.workers.dev/api/voice?token=IL_TUO_APP_TOKEN`
     (scrivi a mano `?token=` e poi incolla il token: controlla che non vada a capo)
   - Tocca **Mostra di più**:
     - Metodo: **POST**
     - Corpo della richiesta: **JSON**, con tre campi:
       - `text` (Testo) → variabile **Testo dettato**
       - `lat` (Testo) → variabile **Posizione attuale**, poi toccala e scegli **Latitudine**
       - `lon` (Testo) → variabile **Posizione attuale**, poi toccala e scegli **Longitudine**
4. **Ottieni valore dizionario**
   - Ottieni **Valore** per la chiave `reply` in **Contenuti dell'URL**
5. **Leggi testo** (su alcune versioni di iOS si chiama *Pronuncia testo*) → **Valore dizionario**
   (in alternativa **Mostra risultato**: con "Ehi Siri" viene letto ad alta voce lo stesso)

**Per far rispondere alle domande di Siri** (consigliato), aggiungi in fondo:

6. **Ottieni valore dizionario** → chiave `ask` in **Contenuti dell'URL**
7. **Se** → *Valore dizionario* **è** `si`. Dentro il blocco "Se":
   1. **Detta testo** (Italiano, dopo una pausa)
   2. **Ottieni contenuti dell'URL**: stesso URL con `?token=…`, metodo **POST**, corpo **JSON** con due campi:
      - `text` → il **Testo dettato** appena aggiunto (il secondo)
      - `answer` → scrivi semplicemente `si`
   3. **Ottieni valore dizionario** → chiave `reply` in questi nuovi **Contenuti dell'URL**
   4. **Leggi testo** → questo nuovo **Valore dizionario**

   Il blocco "Altrimenti" lascialo vuoto.

Chiama il comando **"Nota promemoria"** (tocca il nome in alto). Da ora basta dire:

> **"Ehi Siri, nota promemoria"** → Siri ti ascolta → detti → Siri ti conferma cosa ha salvato.

Suggerimenti:
- Puoi scegliere un altro nome (es. "Aggiungi impegno"). Evita nomi già usati da Siri, come "Ricordami" o "Promemoria", che aprono l'app Promemoria di Apple.
- Aggiungi il comando alla schermata Home o al **tasto Azione** (iPhone 15 Pro e successivi): così basta premere un tasto e parlare.
- Su Apple Watch il comando funziona allo stesso modo.
- La prima volta iOS ti chiede il permesso di inviare dati al tuo server e di usare la posizione: rispondi **Consenti sempre**.

---

## Sviluppo locale

```bash
cp .dev.vars.example .dev.vars    # poi inserisci i tuoi valori
npm run db:init:local
npm run dev                       # http://localhost:8787
npm test                          # test automatici
npm run typecheck
```

### Struttura

| File | Cosa fa |
|---|---|
| `src/index.ts` | API (`/api/voice`, `/api/reminders`, notifiche) e controllo periodico delle scadenze |
| `src/ai.ts` | Interpretazione con l'IA gratuita di Cloudflare (Workers AI), con validazione della risposta |
| `src/parser.ts` | Interprete a regole per l'italiano (date, orari, ricorrenze, luoghi, elenchi, modifiche, domande): riserva quando l'IA non c'è |
| `src/geo.ts` | Ricerca dei luoghi (OpenStreetMap) e calcolo di distanza e tempi (OSRM) |
| `src/push.ts` | Notifiche Web Push cifrate (VAPID + aes128gcm), senza dipendenze |
| `src/time.ts` | Fusi orari e ricorrenze |
| `public/` | Web app installabile (PWA) |
| `migrations/` | Schema del database D1 |

### API

Tutte le chiamate richiedono `Authorization: Bearer APP_TOKEN` (oppure `?token=`).

- `POST /api/voice` `{ text, lat?, lon?, timezone?, answer?, pending_id? }` → `{ reply, ask: "si"|"no", pending_id, created, updated, completed, deleted }`
  - se `ask` è `"si"`, `reply` contiene una domanda: la frase successiva va inviata con `answer: "si"` (o con il `pending_id`).
- `GET /api/reminders` (aperti) · `GET /api/reminders?done=1` (completati)
- `PATCH /api/reminders/:id` `{ done?, title?, notes?, due_date?, due_time?, recurrence?, priority?, place_query?, remind? }` · `DELETE /api/reminders/:id`
  - `remind`: `auto`, `0`, `15`, `30`, `60`, `120` (minuti prima), `daybefore`, `none`
- `POST /api/subscribe` · `POST /api/unsubscribe` · `POST /api/test-push`
- `GET|POST /api/settings` `{ timezone?, digest_time? ("HH:MM" oppure "off") }`

## Privacy

I promemoria stanno nel **tuo** database Cloudflare. Il testo dettato viene interpretato dal tuo server con l'IA di Cloudflare, nel tuo stesso account: non va a servizi esterni. Le ricerche dei luoghi passano da OpenStreetMap con le coordinate approssimative della tua zona.
