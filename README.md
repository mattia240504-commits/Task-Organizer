# Promemoria vocali con Siri

Detti i promemoria come faresti con Siri: **"Ehi Siri, nota promemoria"** → *"domani alle 10 dentista in via Torino 12, poi passare in farmacia e pagare il bollo entro fine mese"*.

L'app capisce la frase, la divide in promemoria separati, li riscrive in modo pulito, calcola date e orari e, se devi andare da qualche parte, trova il posto sulla mappa e ti dice **quanto è distante** da dove sei. Siri ti legge la conferma ad alta voce.

**È tutto gratuito.** Non serve nessuna carta di credito e nessuna intelligenza artificiale a pagamento: le frasi vengono interpretate da regole scritte apposta per l'italiano (`src/parser.ts`), e i dati restano nel tuo account Cloudflare gratuito.

Poi ritrovi tutto nella **web app Promemoria** sulla schermata Home, dove puoi:

- vedere la lista divisa in *In ritardo / Oggi / Domani / Prossimi 7 giorni / Più avanti / Senza data*;
- vedere la distanza aggiornata di ogni luogo da dove ti trovi e aprire le indicazioni in Mappe;
- ricevere una **notifica** all'ora di ogni promemoria e un **riepilogo ogni mattina**;
- segnare le cose come fatte, eliminarle o scriverne di nuove (anche con il microfono 🎤).

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
| "Cosa devo fare oggi?" / "Che impegni ho domani?" | Siri ti legge l'elenco |

Riconosce oggi, domani, dopodomani, stasera, i giorni della settimana, date come "il 20", "25 dicembre" o "15/11", "tra N minuti/ore/giorni", "fine mese", "settimana prossima"; orari come "alle 10", "alle 3 e mezza" o "alle 7 meno un quarto"; ripetizioni come "ogni giorno", "ogni lunedì", "nei giorni feriali" o "il 5 di ogni mese"; e luoghi come farmacia, posta, banca, supermercato, medico, indirizzi tipo "via…", "piazza…" o "corso…".

Funziona meglio con frasi dirette ("cosa + quando"). Non essendoci un'IA, una frase molto contorta può finire in un titolo poco elegante: in quel caso lo correggi dall'app.

---

## Come funziona

```
iPhone ── "Ehi Siri, nota promemoria" ──► Comando rapido
              (testo dettato + posizione)          │
                                                   ▼
                    Server su Cloudflare (gratis) ──► interprete delle frasi (regole italiane)
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

Il comando stampa un `database_id`: copialo in `wrangler.toml` al posto di `SOSTITUISCI_CON_ID_DATABASE`. Poi crea le tabelle:

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

Alla fine vedrai un indirizzo del tipo `https://promemoria.TUONOME.workers.dev`. È il tuo server.

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
   - URL: `https://promemoria.TUONOME.workers.dev/api/voice`
   - Tocca **Mostra di più**:
     - Metodo: **POST**
     - Intestazioni: aggiungi `Authorization` con valore `Bearer IL_TUO_APP_TOKEN`
       (la parola *Bearer*, uno spazio, poi il token)
     - Corpo della richiesta: **JSON**, con tre campi:
       - `text` (Testo) → variabile **Testo dettato**
       - `lat` (Testo) → variabile **Posizione attuale**, poi toccala e scegli **Latitudine**
       - `lon` (Testo) → variabile **Posizione attuale**, poi toccala e scegli **Longitudine**
4. **Ottieni valore dizionario**
   - Ottieni **Valore** per la chiave `reply` in **Contenuti dell'URL**
5. **Pronuncia testo** → **Valore dizionario**
   (in alternativa **Mostra risultato**, se preferisci leggere invece di ascoltare)

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
| `src/parser.ts` | Interprete delle frasi in italiano (date, orari, ricorrenze, luoghi, elenchi, domande) |
| `src/geo.ts` | Ricerca dei luoghi (OpenStreetMap) e calcolo di distanza e tempi (OSRM) |
| `src/push.ts` | Notifiche Web Push cifrate (VAPID + aes128gcm), senza dipendenze |
| `src/time.ts` | Fusi orari e ricorrenze |
| `public/` | Web app installabile (PWA) |
| `migrations/` | Schema del database D1 |

### API

Tutte le chiamate richiedono `Authorization: Bearer APP_TOKEN` (oppure `?token=`).

- `POST /api/voice` `{ text, lat?, lon?, timezone? }` → `{ reply, created, completed, deleted }`
- `GET /api/reminders` (aperti) · `GET /api/reminders?done=1` (completati)
- `PATCH /api/reminders/:id` `{ done?, title?, notes?, remind_at? }` · `DELETE /api/reminders/:id`
- `POST /api/subscribe` · `POST /api/unsubscribe` · `POST /api/test-push`
- `GET|POST /api/settings` `{ timezone?, digest_time? ("HH:MM" oppure "off") }`

## Privacy

I promemoria stanno nel **tuo** database Cloudflare. Il testo dettato viene interpretato dal tuo server e non è inviato a nessun servizio di intelligenza artificiale. Le ricerche dei luoghi passano da OpenStreetMap con le coordinate approssimative della tua zona.
