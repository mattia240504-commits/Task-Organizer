# Promemoria con Siri + Claude

Detti i promemoria come faresti con Siri: **"Ehi Siri, Claude promemoria"** → *"domani alle 10 dentista in via Torino, poi passare in farmacia, e pagare il bollo entro fine mese"*.

Claude capisce cosa intendi, divide la frase in promemoria separati, li riscrive in modo chiaro, calcola date e orari e, se devi andare da qualche parte, trova il posto sulla mappa e ti dice **quanto è distante** dalla tua posizione. Siri ti legge la conferma ad alta voce.

Poi ritrovi tutto nella **web app Promemoria** sulla schermata Home, dove puoi:

- vedere la lista divisa in *In ritardo / Oggi / Domani / Prossimi 7 giorni / Più avanti / Senza data*;
- vedere la distanza aggiornata di ogni luogo da dove ti trovi e aprire le indicazioni in Mappe;
- ricevere una **notifica** all'ora di ogni promemoria e un **riepilogo ogni mattina**;
- segnare le cose come fatte, eliminarle oppure dettare direttamente dall'app (pulsante 🎤).

Puoi parlare a Claude anche in altri modi:

| Cosa dici | Cosa succede |
|---|---|
| "Ricordami domani di chiamare il commercialista" | Promemoria domani alle 9:00 |
| "Oggi devo fare la spesa, la lavatrice e rispondere a Luca" | 3 promemoria per oggi |
| "Venerdì alle 18 aperitivo da Marco in corso Como" | Appuntamento con notifica un'ora prima e distanza dal posto |
| "Entro il 20 devo consegnare il modulo ISEE" | Scadenza con avviso il giorno prima |
| "Ogni mattina alle 8 prendere la vitamina" | Promemoria giornaliero |
| "Ho fatto la spesa" | Segna come fatto il promemoria corrispondente |
| "Cosa devo fare oggi?" | Siri ti legge l'elenco |

---

## Come funziona

```
iPhone ── "Ehi Siri, Claude promemoria" ──► Comando rapido
              (testo dettato + posizione)          │
                                                   ▼
                    Server su Cloudflare (gratis) ──► Claude (interpreta la frase)
                         │   database D1          ──► OpenStreetMap (luogo e distanza)
                         │
                         ├──► risposta letta da Siri
                         └──► ogni minuto controlla le scadenze ──► notifica push sull'iPhone
                                                                       ▲
             Web app "Promemoria" sulla schermata Home ────────────────┘
```

Costi: Cloudflare è gratuito per questo uso. Claude si paga a consumo: ogni frase costa una frazione di centesimo.

---

## Installazione passo passo

Ti servono un computer (Mac, Windows o Linux) con [Node.js](https://nodejs.org) 20 o più recente, e circa 20 minuti.

### 1. La chiave di Claude (API key)

1. Vai su **https://console.anthropic.com** e crea un account.
2. In **Billing**, aggiungi un metodo di pagamento e qualche euro di credito (5 € durano mesi).
3. In **API Keys** premi **Create Key**, dagli un nome (es. "promemoria") e **copia la chiave** (inizia con `sk-ant-…`). Tienila da parte: non sarà più visibile.

### 2. Account Cloudflare

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

Ora imposta i quattro segreti. Ogni comando ti chiede il valore da incollare:

```bash
npx wrangler secret put ANTHROPIC_API_KEY    # la chiave sk-ant-… del punto 1
npx wrangler secret put APP_TOKEN            # una password lunga inventata da te (es. 30 caratteri a caso)
npx wrangler secret put VAPID_PUBLIC_KEY     # il valore stampato da npm run vapid
npx wrangler secret put VAPID_PRIVATE_KEY    # il valore stampato da npm run vapid
```

> `APP_TOKEN` è la password che protegge i tuoi promemoria: serve all'app e al comando rapido. Non condividerla.

### 5. Pubblica

```bash
npm run deploy
```

Alla fine vedrai un indirizzo del tipo `https://promemoria-claude.TUONOME.workers.dev`. È il tuo server.

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
   - URL: `https://promemoria-claude.TUONOME.workers.dev/api/voice`
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

Chiama il comando **"Claude promemoria"** (tocca il nome in alto). Da ora basta dire:

> **"Ehi Siri, Claude promemoria"** → Siri ti ascolta → detti → Siri ti conferma cosa ha salvato.

Suggerimenti:
- Puoi scegliere un altro nome (es. "Nota per Claude"). Evita nomi già usati da Siri, come "Ricordami" o "Promemoria", che aprono l'app Promemoria di Apple.
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
| `src/claude.ts` | Prompt e schema con cui Claude trasforma la frase in promemoria |
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

I promemoria stanno nel **tuo** database Cloudflare. Il testo dettato viene inviato a Claude (Anthropic) per essere interpretato. Le ricerche dei luoghi passano da OpenStreetMap con le coordinate approssimative della tua zona.
