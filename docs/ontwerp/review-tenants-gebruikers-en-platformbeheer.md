# Review: Tenants, gebruikers en platformbeheer

**Reviewdatum:** 2026-08-08
**Gereviewd document:** `tenants-gebruikers-en-platformbeheer.md` (voorstel, 2026-08-08)
**Beoordelingscriteria:** veilig, niet te omslachtig, goed onderhoudbaar

---

Dit is een sterk stuk — de driedeling identiteit/tenant/rol/platform is helder, en het "elk recht expliciet + getest" principe is precies het juiste soort discipline voor een oplossing die één persoon met VS Code moet kunnen onderhouden. Hieronder de review langs de eigen vragen uit §9 van het document, plus een expliciet oordeel over complexiteit.

## 9.1 Koppelen op e-mailadres — verantwoord, met één aanvulling

Verantwoord om nu geen uitnodigingstoken te bouwen. Het faalpatroon dat wordt voorkomen is precies wat Microsoft's onderzoek naar "pre-hijacking attacks" beschrijft als de klassieke fout: accounts samenvoegen op e-mailadres zonder eigenaarschap te verifiëren ([Microsoft MSRC](https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks)). Recente CVE's laten zien wat er misgaat als je de `email_verified`-check weglaat: Logto matchte SSO-logins puur op e-mailadres zonder die claim te eisen, en kreeg daardoor een account-takeover-kwetsbaarheid ([Securityonline.info](https://securityonline.info/logto-vulnerabilities-sso-bypass/)). De vier voorwaarden uit het voorstel zitten daar dus al vóór op.

De vraag die overblijft — "is `email_verified` genoeg bij federatie" — is terecht. Microsoft noemt dit specifieke geval de **"Non-Verifying IdP Attack"**: het vertrouwen verschuift naar de identity provider van de klant, niet naar de eigen tenant ([Microsoft MSRC](https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks)). Voor B2B-federatie via de eigen Entra-tenant van de klant is dat risico klein (de klant-IT beheert die claim al voor hun eigen systemen), maar niet nul. Twee cash-neutrale aanvullingen, geen nieuwe infrastructuur:

- **Vijfde voorwaarde: vervaltermijn op de wachtende rij.** Een gebruiker zonder `oid` blijft nu voor altijd koppelbaar. Zet er een vervaldatum op (bijv. 90 dagen) — sluit het venster zonder een tokenketen te bouwen.
- **Detectieve controle i.p.v. preventieve.** Log de koppeling niet alleen in de audit trail, maar laat 'm ook zichtbaar zijn voor de platformbeheerder (bijv. in het tenantoverzicht van §5.3) zodat een onverwachte koppeling opvalt. Dat is goedkoper dan een uitnodigingslink en dekt het restrisico voldoende af op deze schaal.

## 9.2 Rechtenprincipe — juiste antwoord, maar niet compleet

Het principe klopt en is precies zo zwaar als nodig: expliciete grants, per migratie, met een terugleestest. Dat is standaard least-privilege-praktijk, niet overengineering.

**Wat ontbreekt: dezelfde discipline geldt voor `search_path` in de drie `SECURITY DEFINER`-functies.** Dit is een reëel, goed gedocumenteerd lek-patroon: als een `SECURITY DEFINER`-functie geen expliciete `search_path` heeft, kan een gebruiker met `CREATE`-recht op een doorzocht schema (zoals `public` of de tijdelijke tabel-schema) een object naar keuze laten "schaduwen" en zo met de rechten van de functie-eigenaar code laten draaien — effectief een escalatie langs de eigen RLS-grens heen ([PostgreSQL docs](https://www.postgresql.org/docs/current/sql-createfunction.html), [Cybertec PostgreSQL](https://www.cybertec-postgresql.com/en/abusing-security-definer-functions/)). Ook Supabase-specifieke bronnen noemen dit expliciet een "niet-Supabase-specifieke" valkuil die precies dit functietype raakt ([tomodahinata.com](https://tomodahinata.com/en/blog/supabase-security-definer-function-search-path-guide)).

Concreet: voeg aan de rechtentest uit Stap 2 een check toe die per `SECURITY DEFINER`-functie afdwingt dat `SET search_path = ''` (of een vast, niet-schrijfbaar schema + `pg_temp` als laatste) is gezet. Dat is dezelfde soort test als voorgesteld voor `GRANT`s — alleen dan voor een impliciete aanname die net zo gevaarlijk is.

Losstaand: de hoofdletterongevoelige dubbele-tenantnaam-bug uit §1 staat niet in de reparatielijst van §6. Bewust uitgesteld, of gemist?

## 9.3 Rollenmodel — klopt, met twee kanttekeningen

Vier rollen langs vier vragen is precies zo minimaal als het kan zijn — goed voor onderhoudbaarheid, want een nieuwe bijdrager kan het model in één blik reconstrueren.

- **`support` als leesrol:** consistent met de expliciete ADR-015-keuze (auditbaarheid boven gemak) en prima als eerstelijns-diagnose. Documenteer wel expliciet het vervolg: als een helpdeskmedewerker het probleem ziet maar niet mag oplossen, wat is dan de stap daarna? Een notitie voor de tenant-admin, of een escalatiepad? Dat hoeft nu niet gebouwd te worden, maar wel benoemd, anders ontdekt de eerste helpdeskcase het gat.
- **Acht uur:** redelijk voor een leesrol. Best-practice voor tijdelijke verhoogde toegang adviseert kortere vensters (30–60 min) vooral bij schrijftoegang, met langere vensters acceptabel bij laag risico en asynchroon werk ([Cyber Defense Magazine](https://www.cyberdefensemagazine.com/just-in-time-jit-privilege-for-humans-workloads/)) — een leesrol over een werkdag past daarbinnen. Maak de duur wel instelbaar (parameter, geen hardcoded constante), zodat bijstellen geen migratie kost.
- **Platformbeheerder nooit tegelijk tenant-admin:** correcte functiescheiding, niet aanpassen.

## 9.4 SECURITY DEFINER voor het tenantoverzicht — juiste vorm

Een vierde afzonderlijke rol zou hier meer complexiteit toevoegen, niet minder: dan zou alsnog RLS-policies of een `BYPASSRLS`-uitzondering geregeld moeten worden om de tenant-overstijgende lijst mogelijk te maken. De `SECURITY DEFINER`-functie hergebruikt een patroon dat er al twee keer staat (`sessie_oplossen`, `gebruiker_bij_subject`) — dat is precies de juiste trade-off tussen veiligheid en "één ding om te snappen".

Twee dingen om in de tegenproef van Stap 4 mee te nemen: `search_path` pinnen (zie 9.2) en een test die bevestigt dat `EXECUTE` is ingetrokken van `PUBLIC` en alleen aan de applicatierol is gegeven — het document beschrijft dat al in tekst, maak het ook een geautomatiseerde check.

## 9.5 Wat ontbreekt

- `search_path`-discipline op de drie `SECURITY DEFINER`-functies (grootste concrete gat, zie 9.2).
- De hoofdletterongevoelige naam-bug uit §1 staat niet in de reparatielijst.
- **Offboarding:** geen beschreven pad voor het intrekken van een `tenant_membership` of het loskoppelen van een `external_subject` als iemand de klantorganisatie verlaat. Net als self-service-onboarding mag dit bewust uitgesteld zijn, maar zet het dan ook met zoveel woorden in §7 als expliciete niet-scope, zoals de andere punten daar.
- **Bootstrap van `platform_admin` zelf:** de tabel is `SELECT`-only voor de applicatierol, dus een tweede platformbeheerder toevoegen kan alleen via een directe database-actie. Voor één eigenaar geen probleem, maar een impliciete schaalgrens die het waard is te benoemen naast de andere bekende beperkingen.
- **Per-request handhaving van het `support`-verval:** §5.3 noemt een RLS-filter op `verloopt_op` — bevestig dat dit inderdaad bij elke query wordt gecheckt en niet alleen bij het aanmaken van de sessie, anders overleeft een lopende sessie het verval van de toegang.

## Oordeel: complexiteit en onderhoudbaarheid

Op de vraag die expliciet gesteld werd — is dit niet te omslachtig: nee. Het geheel bestaat uit vier lagen, drie `SECURITY DEFINER`-functies volgens één herbruikt patroon, geen aparte autorisatieservice, geen impersonatie-subsysteem. Dat is proportioneel voor "tientallen tenants, één beheerder". De echte kosten zitten in tests (de rechtencontrole, de tegenproeven) in plaats van in extra machinerie — dat is precies de juiste plek om de kosten te leggen, want tests zijn over een jaar nog te lezen en tribale kennis niet.

Enig aandachtspunt voor de toekomst: laat `support` een gewone `tenant_membership`-rij met een vervaldatum blijven (zoals nu ontworpen) en voeg er geen apart sessietype of speciale-geval-logica aan toe zodra de eerste helpdeskcase iets ingewikkelders vraagt — dat is waar dit soort ontwerpen meestal alsnog omslachtig wordt.

## Tegen het eigen beoordelingskader (§10)

| Criterium | Oordeel |
|---|---|
| Security & tenant-isolatie | Sterk, met twee gaten: `search_path`-pinning en de e-mailkoppeling-vervaltermijn |
| Onderhoudbaarheid | Goed — consistent hergebruik van één patroon, expliciete rechten |
| Transporteerbaarheid | Klopt zodra Stap 1–2 zijn doorgevoerd; geen Supabase-specifieke aannames gezien |
| Aantoonbaarheid | Nog niet compleet: de rechtentest moet ook `search_path` en `EXECUTE`-grants meenemen, niet alleen tabel-`GRANT`s |

## Bronnen

- Microsoft Security Response Center — [Pre-hijacking attacks](https://www.microsoft.com/en-us/msrc/blog/2022/05/pre-hijacking-attacks)
- Securityonline.info — [Logto Vulnerabilities Allow SSO Authentication Bypass](https://securityonline.info/logto-vulnerabilities-sso-bypass/)
- PostgreSQL documentatie — [CREATE FUNCTION (search_path)](https://www.postgresql.org/docs/current/sql-createfunction.html)
- Cybertec PostgreSQL — [Abusing SECURITY DEFINER functions](https://www.cybertec-postgresql.com/en/abusing-security-definer-functions/)
- tomodahinata.com — [The pitfall of Supabase's SECURITY DEFINER functions](https://tomodahinata.com/en/blog/supabase-security-definer-function-search-path-guide)
- Cyber Defense Magazine — [Just-in-Time (JIT) Privilege for Humans & Workloads](https://www.cyberdefensemagazine.com/just-in-time-jit-privilege-for-humans-workloads/)
- PostgreSQL documentatie — [Row Security Policies (FORCE ROW LEVEL SECURITY)](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
