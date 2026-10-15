# Fasering &amp; bouwvolgorde

**Status:** bijgewerkt 24-08-2026 (ADR 0005 — module op mcm2). Bevat nu ook de directe, concrete uitvoeringsvolgorde naast de langere-termijn blokfasering.

## Directe uitvoering (bevestigd 24-08-2026)

Dit is de volgorde voor de eerstkomende stappen, vóór er sprake is van "blokken bouwen" in de zin van dit document.

### Stap 1 — Transdev-survey nu, handmatig

Voer de super eenvoudige survey voor Transdev uit via het bestaande mcm2-mechanisme. Kees is hierbij platformbeheerder, tenant admin én gebruiker tegelijk. Registreer expliciet welke frictie optreedt (onvolledige stamdata, onbekende contactpersoon, geen zicht op respons) — dit is directe, goedkope input voor stap 2 en 3, niet alleen een afgeronde klus.

### Stap 2 — mcm2-verfijning, gesplitst

**2a — gedeeld fundament (blokkerend voor de NIS2-tool).** Tenant-/leveranciers-/contactpersoon-/rollenmodel verfijnen, en de orchestratie/notificatie tot een eigen, herbruikbare interne dienst maken (bestaat nog niet). Dit moet staan vóórdat de NIS2-module in detail gebouwd wordt — anders ontwerp je tegen een fundament dat kort daarna alsnog verandert.

**2b — overige mcm2-gap-analyse (niet blokkerend).** Verfijning van andere mcm2-functies volgens de gap-analyse met een eerder gebouwde mcm2-frontend, voor zover dit niets met leveranciersbeoordeling te maken heeft (contractspecifieke functies e.d.). Mag parallel aan of na stap 3 lopen — hoeft de NIS2-tool niet op te houden.

### Stap 3 — NIS2-tool als module bouwen

Bouw de NIS2-module op het (via 2a) ververste gedeelde fundament, in plaats van een eigen kopie te maken. Vanaf hier gelden de blokken en de fasering hieronder.

## Blokfasering (na stap 3 hierboven)

### Fase A — Beoordelingskern

Blok 2, 3 (stream A) + blok 4, 5 (stream B, volledige diepte, ISO 27002-taxonomie/SC10-SC30 — ADR 0003) + blok 7 (risicomatrix, basis). Bouwt op het gedeelde fundament (tenant/leverancier/rollen/orchestratie) uit stap 2a — geen aparte bouwtaak meer voor blok 0/1/8 in de oude zin.

### Fase B — Aantoonlaag

Blok 6 (bewijsstukken) + blok 10 (audit trail/rapportage — ook bruikbaar als auditvoorbereiding voor een echte SC10/20/30-certificering).

### Fase C — Configuratie &amp; schaal

Blok 9 (normenkader-configuratie — concreet de SC10/20/30-tiering, gekoppeld aan het risiconiveau uit blok 3) + blok 7-portfolio-uitbreiding.

### Fase D — Onboarding &amp; verpakking

Blok 12 (import vanuit ZCERT-excel) + het productmatige ontwerp van de proefperiode/aanmeldflow (ADR 0002/0005 — hoe voelt "de NIS2-tool" zelfstandig aan bovenop het gedeelde platform).

## Openstaande vragen

1. TBB i.p.v./naast BIV in blok 3 — ja/nee?
2. Moet stream A altijd afgerond zijn vóór stream B naar de leverancier wordt uitgezet, of parallel?
3. Exacte proeflimiet (aantal leveranciers), rapport-export sowieso betaald?
4. Codetaalconventie (Engels/Nederlands in code).
5. Verdeling van SC10/20/30-criteria tussen blok 4 en blok 5 — volledige normdocumenten nog op te halen.
6. Precieze afbakening tussen stap 2a en 2b — te verfijnen zodra de mcm2-gap-analyse start.
7. Hoe de proefperiode/aanmeldflow er productmatig uitziet bovenop één gedeeld platform (fase D).

## Aanvulling 14-10-2026 (voorstel, ADR 0006)

Transdev blijft geen voorwaarde voor de NIS2-module: de pilot leverde geen respons en schuift naar contractmanagement. De directe volgorde wordt: (1) dunne doorsnede op een eigen tenant met een SC10-concepttemplate, (2) feature-key `nis2module`, (3) stream A + risicomatrix, (4) fundament-verfijning (2a) incrementeel mee. Marketing start parallel met pilotklanten en eerste boodschappen uit `marktsignalen-ncsc-2026-10.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\). Zie `decisions/0006-transdev-geen-voorwaarde.md` en `overview/gebruikersontwerp-nis2.md`.
