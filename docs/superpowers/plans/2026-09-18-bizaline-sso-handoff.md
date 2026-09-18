# Outline — MCM2 starten vanuit de legacy Bizaline-app (handoff zonder Entra)

**Status:** outline, geen goedgekeurd uitvoeringsplan. Wacht op antwoorden van
Bizaline (zie vragenlijst hieronder) voordat dit wordt uitgewerkt tot een
concreet technisch plan met migratienummer, routes en tests.

**Gerelateerd issue:** #TBD (aan te maken)

---

## 1. Aanleiding

Transdev gebruikt naast MCM2 een legacy contractmanagement-app van Bizaline,
met een eigen zijbalk waarin elementen aanklikbaar zijn. Gevraagd: laat MCM2
vanuit die zijbalk opstarten, met de gebruiker al ingelogd — zonder dat die
gebruiker via Entra External ID (opnieuw) hoeft te registreren of in te
loggen.

**Scope-bepalende beslissing van de eigenaar (18-09-2026):** de identiteit
komt uit de legacy Bizaline-app en wordt door MCM2 overgenomen. Er wordt géén
Entra-account aangemaakt of gebruikt voor dit pad. Wél blijft er een bestaand
MCM2-account/membership per Transdev-medewerker nodig (aangemaakt via de
normale uitnodigingsflow) — de handoff wijst dat account aan via
e-mailadres, in plaats van dat de gebruiker het activeert via een
Entra-login.

## 2. Uitgangspunten (vastgelegd, niet heronderhandelen zonder reden)

- MCM2 opent in zijn eigen omgeving (nieuw tabblad/venster) — geen iframe/
  embedding.
- Bizaline beheert zowel de legacy-app als MCM2 — dit is geen koppeling met
  een onbekende externe partij; het protocol is intern te bepalen.
- De legacy-app heeft een eigen backend die server-to-server aanroepen kan
  doen (bevestigd door de eigenaar in het voorgesprek; **nog te bevestigen
  door Bizaline zelf**, zie vragenlijst).
- Geen wijziging aan hoe bestaande Entra-gebruikers werken. Geen wijziging
  aan `clm.user.external_subject`/de oid-koppeling.

## 3. Voorgestelde aanpak — handoff-token op e-mailadres

Zelfde grondpatroon als het bestaande `clm.sessie_wisselen` (een nieuwe
sessie zonder Entra-stap, op basis van een al bekend account), toegepast op
een server-to-server aanvraag in plaats van een gebruikersactie binnen MCM2
zelf.

**Stroom**
1. Gebruiker is ingelogd in de legacy Bizaline-app, klikt in de zijbalk.
2. Legacy-backend doet `POST /auth/handoff/aanvragen` bij MCM2, met het
   e-mailadres van de gebruiker. Beveiligd met een gedeeld geheim
   (API-sleutel via environment-variabele), niet zichtbaar voor de
   eindgebruiker.
3. MCM2 zoekt een actief membership bij de Transdev-tenant op dit
   e-mailadres. Gevonden → genereert een kortlevend (~60s), eenmalig
   handoff-token, koppelt aan user_id, geeft terug. Niet gevonden → generieke
   afwijzing (geen informatie lekken over wie wel/niet bestaat).
4. Legacy-backend stuurt de browser naar
   `https://clm.alingadvies.nl/auth/handoff?token=...`.
5. MCM2 (`GET /auth/handoff`) wisselt het token in, maakt een gewone sessie
   aan (bestaande sessie-tabel/cookie-mechaniek, ongewijzigd), zet het
   cookie, redirect naar `/`.

**Nieuwe onderdelen**
- Tabel `clm.handoff_token` (token_hash, user_id, verloopt_op, gebruikt_op) —
  dicht voor de runtime-rol, zelfde stijl als `clm.sessie` (migratie
  0010/0033).
- `SECURITY DEFINER`-functies: `clm.handoff_token_aanmaken(email)` (met
  membership-check, analoog aan `clm.sessie_aanmaken`) en
  `clm.handoff_token_inwisselen(token_hash)`.
- Route `POST /auth/handoff/aanvragen` (server-to-server, gedeeld geheim).
- Route `GET /auth/handoff` (publiek, tokenwissel + sessie — vorm vergelijkbaar
  met bestaande `/auth/callback`, zonder de OIDC-stappen).

**Wat ongewijzigd blijft**
- Nieuwe Transdev-medewerkers komen nog steeds via de bestaande
  uitnodigingsflow (platformbeheerder nodigt uit) — alleen wordt de
  activeringsstap via Entra vervangen door: automatisch ingelogd bij eerste
  gebruik via de zijbalk.
- Tenant volgt nog steeds uitsluitend uit het membership in de database —
  geen tenant uit client-invoer (Platformgarantie 1 blijft intact).

## 4. Architectuurimpact — expliciet te behandelen

Dit raakt **Platformgarantie 2** (`docs/ARCHITECTUUR.md`): er komt een
tweede, server-to-server vertrouwde weg naar een sessie, naast OIDC. Vereist:

- Nieuwe of herziene ADR (zie ADR-016, "identity provider is inwisselbaar" —
  dit is geen vervanging van de provider maar een tweede toegangspad ernaast,
  dus waarschijnlijk een nieuwe ADR).
- Bijwerken van `docs/ARCHITECTUUR.md` Platformgarantie 2 in dezelfde PR als
  de implementatie (net zoals het document zelf voorschrijft).
- Kwartaal-SECURITY-DEFINER-audit (MCM2-CLAUDE.md §6) uitbreiden met de twee
  nieuwe functies.

## 5. Bekend risico

E-mailadres als identifier is zwakker dan Entra's `oid` (zie
`src/auth/README.md`: e-mail kan wijzigen, en er is geen cryptografische
binding aan een specifieke persoon). Het risico wordt beperkt doordat de
aanvraag alleen door de vertrouwde Bizaline-backend gedaan kan worden (gedeeld
geheim) — dus dit staat of valt met de garantie dat de legacy-app het juiste
e-mailadres van de daadwerkelijk ingelogde gebruiker meegeeft. Zie vraag 2 in
de vragenlijst.

## 6. Open vragen voor Bizaline (te beantwoorden vóór uitwerking)

**Over hun backend en wat die kan**
1. Heeft de legacy-app een eigen backend die zelf een HTTP-aanroep naar een
   andere server kan doen (niet alleen tonen in de browser)?
2. Kan die backend, bij een klik op een zijbalk-element, betrouwbaar het
   e-mailadres van de ingelogde gebruiker meegeven — hetzelfde adres als
   waarmee die persoon in MCM2 bekend staat/wordt uitgenodigd?
3. Kunnen zij een geheime sleutel veilig bewaren aan hun kant (niet in
   browser-code, niet publiek) om hun aanvragen bij MCM2 te ondertekenen?

**Over de gebruikers**
4. Wie zijn de Transdev-medewerkers die dit gaan gebruiken, en wat zijn hun
   e-mailadressen?
5. Verandert die lijst vaak, en wie meldt wijzigingen — Bizaline of Transdev
   rechtstreeks?

**Over het gewenste gedrag**
6. Waar moet iemand na de klik terechtkomen — startscherm, of een specifiek
   contract/leverancier bij het aangeklikte element? (Bij het tweede: extra
   context nodig in de handoff-aanvraag — uitbreiding op dit voorstel.)
7. Nieuw tabblad/venster, of hetzelfde tabblad?

**Praktisch**
8. Wie bij Bizaline bouwt/test dit, en op welke termijn?

## 7. Vervolgstappen

1. Antwoorden ophalen bij Bizaline (vragenlijst §6).
2. Op basis daarvan: dit document uitwerken tot een concreet technisch plan
   (migratienummer, exacte route-specificaties, testplan) — via
   `superpowers:writing-plans`.
3. Nieuwe ADR schrijven voor de uitbreiding van Platformgarantie 2.
4. Labelen volgens `MCM2-CLAUDE.md §0a`: `product:td` (Transdev/Bizaline-
   specifiek maatwerk, geen kern-feature), prioriteit nog te bepalen — dit is
   geen toezegging aan Transdev, dus vermoedelijk `priority:later` tot een
   trigger optreedt (Bizaline's antwoorden, of een concrete vraag vanuit
   Transdev).
