# Runbooks — index

**Type:** R — referentie
**Eigenaar:** de eigenaar (Chris)
**Laatste update:** 2026-08-10

Elk runbook beschrijft één handeling: wat je doet, wat je mag verwachten, en wat
je doet als het anders uitpakt. Deze index is de enige plek waar ze allemaal
staan — [verify:onderhoud](onderhoudskalender.md#4-hoe-dit-document-actueel-blijft)
faalt als er een runbook bijkomt dat hier niet genoemd wordt.

---

## Begin hier

| Runbook | Waarvoor | Type |
|---|---|---|
| [commandos-en-omgeving.md](commandos-en-omgeving.md) | **Lees dit eerst.** Welk commando bestaat er echt, waar praat het naartoe, wat mag nooit. `.env` wijst naar de productiedatabase. | R |
| [onderhoudskalender.md](onderhoudskalender.md) | Wat er terugkeert en wanneer — automatisch én met de hand. Plus wat nog niet beschreven is. | D |

---

## Routineoperaties — dingen die terugkeren

| Runbook | Waarvoor | Ritme |
|---|---|---|
| [backupcontrole.md](backupcontrole.md) | De backup en de drie controlelagen; hoe de Telegram-meldingen werken en wat ze betekenen | dagelijks + wekelijks, automatisch |
| [supabase-verificatie-en-restoretest.md](supabase-verificatie-en-restoretest.md) | Vaststellen wat Supabase werkelijk levert, en een dump aantoonbaar terugzetten | maandelijks |
| [otap-doorloop.md](otap-doorloop.md) | De volledige keten O→T bewijzen tegen de productie-images | bij elke release |
| [zelf-testen.md](zelf-testen.md) | Zelf door de demo-omgeving klikken: echte frontend, echte backend, gevulde database | naar behoefte |

---

## Eenmalig of op aanvraag

| Runbook | Waarvoor | Type |
|---|---|---|
| [mailkanaal-inrichten.md](mailkanaal-inrichten.md) | Resend en het verzenddomein opzetten | C — toegang en credentials |
| [baseline-migratiestand.md](baseline-migratiestand.md) | Een bestaande database in de migratieketen halen, met rollback | A — eenmalige databasehandeling |

---

## Geen runbook, wel data

| Bestand | Waarvoor |
|---|---|
| [backup-verwachting.json](backup-verwachting.json) | Onafhankelijke lijst van tabellen die in een complete dump horen. **Bijwerken bij elke migratie die een tabel toevoegt.** |

---

## De typen

| Type | Betekenis |
|---|---|
| **R** | Referentie — opzoeken, niet doorlopen |
| **D** | Routineoperatie — keert terug, hoort in de kalender |
| **C** | Toegang en credentials — raakt sleutels of externe accounts |
| **A** | Eenmalige handeling met rollback — je doet dit één keer, en je wilt terug kunnen |

---

## Een nieuw runbook schrijven

Neem de kop over van een bestaand runbook: `Type`, `Eigenaar`, `Laatste update`,
`Vereiste toegang`, en waar van toepassing `Raakt`. De eerste drie zijn
verplicht — `verify:onderhoud` faalt zonder.

Twee dingen die de bestaande runbooks goed doen en die de moeite waard zijn om
over te nemen:

- **Noem per stap het verwachte resultaat, niet alleen het commando.** Zonder dat
  weet je niet of het gelukt is. Vertrouw geen geruststellende melding — dat is
  in dit project twee keer misgegaan.
- **Schrijf op waaróm een stap er staat.** Bijna elke stap in deze runbooks is
  er omdat iets een keer misging. Die reden is waardevoller dan de stap zelf,
  want hij vertelt wanneer de stap mag vervallen.

Voeg het runbook daarna toe aan deze index en, als het terugkeert, aan de
[onderhoudskalender](onderhoudskalender.md).
