# Transdev MVP-scope — Vendor IT Compliance Survey

**Datum:** 2026-07-24 (bijgewerkt: klantvragen beantwoord door de eigenaar, optredend als Transdev-beheerder voor de pilot)
**Status:** scopedefinitie ter beoordeling, geen bindend besluit totdat expliciet goedgekeurd.
**Relatie tot bestaande documenten:** `C:\DEV\Work\MVP_TRANSDEV.md` (2026-06-12, laatst bijgewerkt 2026-06-14) definieert een bredere MVP-scope (42 gap-analyse-items, admin/workspace, requirements, vergaderingen, e-mail-infrastructuur). Deze survey-slice is **niet** hetzelfde als die bredere scope — het is de kleinste bewijsbare productieslice, expliciet aangewezen als eerste concrete MVP-klant-use-case. De bredere MVP_TRANSDEV.md-scope blijft geldig voor latere fases, maar is voor déze productieslice **out of scope** tenzij hieronder expliciet genoemd.

**Waargenomen spanning met bestaande documentatie:** `MVP_TRANSDEV.md` noemt Azure Entra ID en een open AWS-vs-Azure-hosting-beslissing (T-11). De huidige opdracht stelt AWS als beoogd productiedoel vast. **OV-1 is nu beantwoord** (zie hieronder) — dit lost de spanning gedeeltelijk op: er wordt een Cognito+EntraID-federatie-spike voorgesteld, met een gedocumenteerd tijdelijk alternatief als fallback.

---

## In scope — de zeven journeys, letterlijk uit de opdracht

1. Transdev-beheerder beheert leveranciers en contactpersonen.
2. Beheerder start een jaarlijkse survey op basis van een versieerbare template (initieel 5 vragen).
3. Elke leverancier ontvangt een unieke, tijdgebonden response-link.
4. Leverancier vult in, dient veilig in, geen toegang tot andere gegevens.
5. Transdev beoordeelt responsen, volgt status/reminders op, exporteert resultaten.
6. Elke relevante mutatie is tenant-geïsoleerd en auditbaar.
7. Een tweede testtenant kan onder geen beding data/exports/response-links van Transdev gebruiken.

## Out of scope voor déze slice

| Buiten scope | Reden |
|---|---|
| Contracten, taken, issues, certificeringen (buiten wat nodig is om een vendor/contactpersoon te tonen) | Niet nodig voor de survey-flow zelf |
| Requirements-register, statusmachines, boomstructuur eisen | MVP_TRANSDEV.md sectie 2b — aparte, latere fase |
| Vergaderingen/agenda/notulen | MVP_TRANSDEV.md sectie 2c — aparte, latere fase |
| Volledige e-mail-engine met inbox-forwarding (#40) | Alleen **uitgaande** survey-uitnodigingen/reminders nodig |
| Rechtenmatrix per rol per entiteit (granulair, #4) | Voor deze slice volstaat: Transdev-beheerder (intern) vs. externe leverancier (tijdgebonden token) |
| Admin-UI voor tenant-configuratie (#1b) | Pas nodig vóór een tweede echte klant-tenant |
| Excel-bulk-import van vendors (#9) | Voor de pilot volstaat handmatige/CRUD-invoer (ca. 50 vendors, zie OV-5-antwoord — handmatig haalbaar) |
| Correctie-/heropenflow voor ingediende responses | **OV-3 beantwoord: niet corrigeerbaar** — indienen is definitief, geen heropenmechanisme nodig |
| Volledige AWS-doelarchitectuur | Zie 06-prioritized-roadmap.md — alleen een kleine acceptatieomgeving nu |
| Amazon SES als verzendmethode voor déze pilot | **Vervangen door Transdev-eigen SMTP** (zie beantwoorde e-mail-vraag hieronder) — SES blijft relevant voor een latere, bredere/multi-tenant e-mail-oplossing, niet voor deze pilot |

## Rollen

| Rol | Aard | Toegang |
|---|---|---|
| **Transdev-beheerder** | Interne, geauthenticeerde gebruiker. **Voor de pilot: de eigenaar zelf treedt op als Transdev-beheerder.** | Volledig CRUD op eigen vendors/contactpersonen/surveys/responsen binnen de eigen tenant. Geen toegang tot andere tenants. |
| **Externe leverancier (respondent)** | Geen account — toegang uitsluitend via de unieke, tijdgebonden (30 dagen) response-link | Alleen de eigen, specifieke survey-response kunnen invullen/indienen, éénmalig. Geen enkele andere data zichtbaar of bereikbaar. |
| **Tweede testtenant** | Interne testgebruiker, andere tenant dan Transdev | Moet aantoonbaar geen toegang hebben tot Transdev-data, -exports of -response-links. |

## Interne authenticatie — OV-1 beantwoord, spike voorgesteld

**Antwoord van de eigenaar:** de eigenaar heeft een Microsoft business-account (`kees@alingadvies.nl`) met (naar eigen inschatting) beheerdersrechten in de bijbehorende Azure AD-tenant. Voorstel: gebruik dit account om te toetsen of een Cognito+Entra ID-federatie (het patroon dat al in `MCM2-CLAUDE.md` als besluit vastligt — Cognito als federatielaag vóór Entra ID, Plus-tier) daadwerkelijk werkend te krijgen is binnen het tijdsbestek van deze pilot.

**Twee-sporen-aanpak, expliciet vastgelegd zodat dit geen aanname wordt die de pilot blokkeert:**
1. **Spoor A (voorkeur):** Cognito User Pool + Entra ID als geconfigureerde SAML/OIDC-federatie, met een app-registratie in de Azure AD-tenant van `kees@alingadvies.nl`. Dit is een kleine technische spike op zich (aparte van de ORM-spike) — moet apart getimed worden, niet aangenomen als "werkt vanzelf".
2. **Spoor B (fallback, tijdgebonden):** als Spoor A niet binnen een beperkt tijdsbestek werkend te krijgen is, een tijdelijk vereenvoudigd mechanisme (bijv. een enkel, sterk wachtwoord-beveiligd account voor de eigenaar-als-beheerder), met een **expliciete, gedateerde einddatum** waarop dit alsnog naar Spoor A moet zijn omgezet — dit is een bewuste risico-acceptatie, geen permanente oplossing.

**Beslissing wie Spoor A vs. B kiest:** dit is een tijd/haalbaarheids-afweging die pas na een korte technische verkenning (niet in deze analysefase, wel als eerstvolgende actie) genomen kan worden — zie geactualiseerde 06-prioritized-roadmap.md.

## Securitygrenzen — wat deze slice moet bewijzen

1. **Response-links zijn niet raadbaar en niet herbruikbaar na verval.** Uniek, cryptografisch sterk token per (survey × vendor), met een **vervaldatum van 30 dagen** (OV-2 beantwoord), serverzijdig afgedwongen.
2. **Een respondent-token geeft toegang tot precies één response, éénmalig, niets anders.** Na indienen is de response definitief (OV-3: niet corrigeerbaar) — dit vereenvoudigt het ontwerp (geen "heropenen"-state nodig), maar verzwaart de eis dat het indien-moment zelf foutloos moet zijn (geen tweede kans bij een fout).
3. **Tenant-isolatie tussen Transdev en de tweede testtenant moet met een geautomatiseerde test bewezen worden.**
4. **Elke mutatie is een `audit.audit_event`-regel**, inclusief het certificaat-uploadmoment (zie nieuwe sectie hieronder).
5. **Exports zijn zelf ook auditbaar en tenant-gescopet.**
6. **Reminders mogen nooit naar het verkeerde e-mailadres of de verkeerde tenant gaan.**
7. **Nieuw, uit de beantwoorde vragen:** verzending gebeurt via Transdev's eigen SMTP-server namens `contractmanagement@transdev.nl` — de SMTP-credentials zijn een gevoelig gegeven dat op dezelfde manier behandeld moet worden als de databasewachtwoorden elders in dit project (nooit hardcoded, nooit gecommit, via omgevingsvariabelen — zie MCM2-CLAUDE.md Guardrails-checklist).

## Vragenlijst-ontwerp — geconcretiseerd (was: "5 vragen", nu: concreet vraagtype-ontwerp)

De template bestaat uit vragen van (minimaal) twee verschillende typen, niet vijf identieke tekstvragen:

**Vraagtype A — drieledige keuze met conditionele toelichting**
- Antwoordopties: `Confirm` / `Do not confirm` / `Not applicable`.
- Bij `Not applicable`: een tekst-toelichting is verplicht.
- Bij `Confirm`/`Do not confirm`: toelichting is optioneel (niet expliciet aangegeven door de eigenaar — aangenomen als redelijke default, **te bevestigen**, zie nieuwe open vraag OV-6 hieronder).

**Vraagtype B — bestandsupload (certificaat)**
- Eén vraag vraagt om een certificaat als bijlage: `pdf`, `png`, of `jpg`.
- **Nieuwe scope-impact, niet eerder in dit document voorzien:** dit vereist bestandsopslag (S3/MinIO, al genoemd in de bredere architectuur maar nog niet in de Fase 0-code aanwezig — zie 01-current-state-inventory.md) en een uploadmechanisme bereikbaar via het tijdgebonden externe token, met dezelfde isolatie-eisen als de rest van de response (AC5/AC9 gelden onverkort voor het geüploade bestand: een ander token mag dit bestand nooit kunnen benaderen).
- **Open vraag, expliciet niet aangenomen:** is een bestandsgrootte-limiet, virusscan, of specifieke certificaat-validatie (bijv. handtekening-check) vereist, of volstaat "bestand ontvangen en opgeslagen" voor de pilot? Zie OV-7 hieronder.

Het "initieel vijf vragen"-uitgangspunt blijft staan, maar de vijf vragen zijn nu een mix van type A en (minimaal) één type B — exact welke van de vijf vragen welk type is, is nog niet gespecificeerd (zie OV-8).

## MVP user journeys (bijgewerkt)

**Journey A — Beheerder zet leveranciersbestand op**
Ongewijzigd t.o.v. eerdere versie. Schaal nu bekend: **circa 50 vendors** (OV-5 beantwoord) — ruim binnen handmatige CRUD-invoer, geen bulk-import nodig voor de pilot.

**Journey B — Beheerder start jaarlijkse survey**
Beheerder selecteert de template (versie 1, mix van vraagtype A/B) → selecteert vendors → start de ronde → systeem genereert per vendor een uniek, 30-dagen-tijdgebonden token → verstuurt uitnodiging via Transdev's SMTP namens `contractmanagement@transdev.nl`.

**Journey C — Leverancier vult survey in**
Ontvangt e-mail → opent link (geen login) → beantwoordt vraagtype-A-vragen (met verplichte toelichting bij "Not applicable") → uploadt certificaat bij vraagtype B → dient in, **eenmalig en definitief** (OV-3) → link direct ongeldig voor verdere wijziging (niet pas na 30 dagen als al ingediend is).

**Journey D — Beheerder monitort en handelt af**
Ongewijzigd qua structuur; exportformaat nog open (zie OV-4, nog te beantwoorden — zie hieronder, dit was abusievelijk als "OV-4 beantwoord" te lezen in de vorige versie maar de eigenaar beantwoordde feitelijk de vragenlijst-inhoud, niet het exportformaat zelf; zie herziene open-vragenlijst).

**Journey E — Isolatietoets**
Ongewijzigd.

## Acceptatiecriteria — aangevuld

| # | Criterium |
|---|---|
| AC1–AC10 | Ongewijzigd, zie vorige versie van dit document (vendor/contactpersoon-CRUD, template-versionering, token-uniciteit, éénmalig-indienen, isolatie, statusoverzicht/reminder, export, audit, tenant-isolatie, non-bypassrls-rol). |
| AC11 (nieuw) | Response-link is na 30 dagen serverzijdig ongeldig, ongeacht of deze al bezocht is. |
| AC12 (nieuw) | Na één succesvolle indiening is dezelfde link niet meer bruikbaar voor een nieuwe/gewijzigde inzending — geen enkele repeat-submit mogelijk. |
| AC13 (nieuw) | Een geüpload certificaat (pdf/png/jpg) is uitsluitend bereikbaar via hetzelfde token als de bijbehorende response, nooit via een ander token of een directe/geraden bestands-URL. |
| AC14 (nieuw) | Uitgaande e-mail wordt verstuurd namens `contractmanagement@transdev.nl` via de door Transdev aangeleverde SMTP-credentials, nooit via een ander/AWS-eigen afzenderadres voor déze pilot. |

## Expliciete open klantvragen — status bijgewerkt

| # | Vraag | Status |
|---|---|---|
| OV-1 | Interne authenticatiemethode | **Beantwoord**: Cognito+EntraID-spike met `kees@alingadvies.nl` als testaccount, met tijdgebonden fallback als dit niet lukt (zie boven). |
| OV-2 | Vervaltermijn response-link | **Beantwoord: 30 dagen.** |
| OV-3 | Corrigeerbaarheid van ingediende response | **Beantwoord: niet corrigeerbaar, indienen is definitief.** |
| OV-4 | Exportformaat | **Nog open** — de eigenaar beantwoordde de vragenlijst-inhoud (vraagtypes), niet het gewenste exportformaat zelf. Blijft een open vraag. |
| OV-5 | Deadline en schaal | **Beantwoord: circa 50 vendors, deadline 1 september 2026.** Dit is een krappe planningshorizon (ca. 5 weken vanaf nu) — zie impact in geactualiseerde 06-prioritized-roadmap.md. |
| OV-6 (nieuw) | Is een toelichting bij `Confirm`/`Do not confirm` optioneel of ook verplicht? | Aangenomen als optioneel; te bevestigen. |
| OV-7 (nieuw) | Is een bestandsgrootte-limiet, virusscan, of certificaat-inhoudsvalidatie vereist voor de pilot, of volstaat "ontvangen en opgeslagen"? | Bepaalt of MinIO/S3-opslag alleen (eenvoudig) of ook een scanstap (zie MCM2-CLAUDE.md's reeds geplande "malware-scan op uploads", tot nu toe alleen procedureel) nodig is vóór 1 september. |
| OV-8 (nieuw) | Welke van de vijf vragen zijn vraagtype A (keuze) versus vraagtype B (upload)? Is er meer dan één upload-vraag? | Bepaalt het exacte template-schema-ontwerp. |
| OV-9 (nieuw) | SMTP-details (host, poort, authenticatiemethode, TLS) voor `contractmanagement@transdev.nl` | Genoemd als "volgen" — expliciet nog te ontvangen, blokkeert Journey B/C tot deze binnen zijn. |

## Vertrouwenspositie t.o.v. bestaande code/database

Ongewijzigd — zie 09-legacy-discovery-plan.md.
