# ADR-016 — De identity provider doet identiteit, MCM2 doet toegang

**Status:** aanvaard
**Datum:** 2026-08-09
**Raakt:** ADR-015 (platformbeheer), migratie 0009, 0010, 0023, 0024, MCM2-CLAUDE.md §6

---

## Context

Op 2026-08-09 stelde de eigenaar halverwege een sessie over uitnodigingstokens
de vraag die deze ADR uitlokte:

> "zijn we hier nu zelf een complete inlog en sign up toestand aan het bouwen?
> zijn we nu Clerk aan het herbouwen?"

Een terechte vraag op een terecht moment. Die dag was er een uitnodigingstoken
gebouwd (0024), was er gesproken over een uitnodigingsmail, en stond er een
rollenmodel in de database. Alle drie zijn dingen die een
identity-as-a-service-product kant en klaar levert.

Het antwoord luidde nee — maar "nee" op gevoel is geen antwoord. Zonder een
opgeschreven grens is elke volgende auth-feature opnieuw een open vraag, en dan
groeit de authenticatielaag stukje bij beetje richting een eigen provider
zonder dat iemand dat ooit besloten heeft.

Daar komt een tweede eis bij, door de eigenaar in dezelfde adem gesteld: Entra
External ID moet **inwisselbaar** zijn voor bijvoorbeeld AWS Cognito. Niet
omdat er een verhuizing gepland staat, maar omdat een SaaS die op één
leverancier vastzit een risico draagt dat een zakelijke klant terecht
adresseert.

## Besluit

**1. Alles wat over identiteit gaat, doet de provider. Alles wat over toegang
gaat, doet MCM2.**

| Onderwerp | Waar het hoort | Waarom |
|---|---|---|
| Registratieformulier, wachtwoordbeleid | provider | wachtwoordopslag is een vak apart |
| Wachtwoord vergeten, e-mailverificatie | provider | idem, plus: bij de provider staat het adres al geverifieerd |
| MFA, conditional access, device compliance | provider | dit is precies wat een corporate klant van *zijn* IdP eist |
| Federatie naar het AD van de klant | provider | een klant wil zijn eigen tenant, niet die van ons |
| Sessiebeheer binnen MCM2 | MCM2 | een sessie draagt de tenantcontext, en die kent de provider niet |
| Welke tenant, welke rol | MCM2 | dit ís het product |
| Uitnodigen van de eerste beheerder | MCM2 | zie hieronder |

**2. De provider is inwisselbaar. Geen enkele providernaam in de code.**

Vastgesteld op 2026-08-09: `src/` bevat geen enkele verwijzing naar Entra,
Microsoft, Azure of `ciamlogin`. De configuratie heet `OIDC_ISSUER`,
`OIDC_TOKEN_ENDPOINT`, `OIDC_JWKS_URI` — de standaard, niet de leverancier.

De hele authenticatielaag is ~2700 regels, waarvan het providerafhankelijke
deel bestaat uit: een autorisatie-URL bouwen, een code inwisselen, en een
JWT verifiëren tegen een JWKS. Alle drie zijn OIDC-standaard.

**Vier claims worden gelezen**, en dat is de volledige koppelvlakte:

| Claim | Waarvoor | Bij Cognito |
|---|---|---|
| `sub` / `oid` | de sleutel in `clm.user.external_subject` | `sub` |
| `email` | koppelen van een uitnodiging | `email` |
| `name` | weergavenaam | `name` |
| `tid` | verificatie van de uitgevende tenant | `iss` doet dit al |

De `idp`-claim werd tot 0024 óók gebruikt, als waarborg bij de eerste login.
Die is er bewust uit gehaald — zie punt 4.

**3. Wat een verhuizing zou kosten, en wat niet.**

Kosten: nieuwe configuratiewaarden, de claimnamen nalopen (Cognito levert `sub`
waar Entra `oid` levert), en — het echte werk — **elke bestaande gebruiker
opnieuw koppelen**. `external_subject` is de identiteit bij de oude provider en
is bij de nieuwe betekenisloos.

Dat laatste is precies waar `clm.koppel_eerste_login()` (0024) voor gemaakt is.
Een verhuizing is dan: alle `external_subject` legen, iedereen een
uitnodigingstoken sturen, en de bestaande koppelroute doet de rest. Geen
migratiescript dat identiteiten raadt.

Niet geraakt door een verhuizing: RLS, `SET LOCAL app.current_tenant_id`, de
tenantgrens, de rollen, de sessietabel, de audit trail. Dat is het product, en
dat staat los van wie de inlog verzorgt.

**4. Een waarborg die de provider beschrijft in plaats van de aanvrager, hoort
hier niet.**

Migratie 0023 eiste bij de eerste login een `idp`-claim. Die eis leek een
beveiliging maar toetste de *vorm* van de login, niet wie er inlogde — en bond
MCM2 tegelijk aan providers die zo'n claim leveren.

0024 verving hem door een uitnodigingstoken: iets dat MCM2 zelf uitgeeft en
zelf kan verifiëren, bij elke provider gelijk. Dat is de vorm die deze ADR
voorschrijft.

**Uitzondering, bewust:** federatie per tenant afdwingen — "alleen ons AD geeft
toegang" — is wél een legitieme eis, en die is providerafhankelijk. Die hoort
per tenant configureerbaar te zijn en bij *elke* login te gelden, niet globaal
en alleen bij de eerste. Te bouwen bij de eerste klant die het vraagt.

## Waar de grens werkelijk schuurt

Twee dingen staan aan de kant van MCM2 die een IaaS-product ook zou leveren.
Ze staan hier omdat ze over tenants gaan, en een provider weet niet wat een
tenant is:

**Uitnodigen van de eerste beheerder.** Clerk heeft organisatie-uitnodigingen;
Entra External ID niet op een manier die weet welke MCM2-tenant erbij hoort.
Vandaar 0024. Dit is de grens, en hij ligt aan de goede kant — maar het is de
plek waar bij een volgende feature opnieuw gewogen moet worden.

**De uitnodigingsmail.** Geparkeerd op 2026-08-09. Dit is het punt waar het
oordeel niet vanzelf spreekt: het is een mail over toegang, en zowel de
provider als MCM2 zou hem kunnen sturen. Reden om hem hier te houden: hij bevat
een MCM2-token en verwijst naar een MCM2-tenant. Reden om te twijfelen: het is
verder gewoon een transactionele mail.

Wordt dit een tweede berichtsjabloon, dan is het nog steeds MCM2-werk. Wordt
het een reeks sjablonen met eigen beheer, dan is dat het signaal dat de grens
verschuift en deze ADR herzien moet worden.

## Toets bij een volgende auth-feature

Eén vraag, in deze volgorde:

1. **Gaat dit over wie iemand ís?** → provider. Bouw het niet.
2. **Gaat dit over wat iemand mág, binnen welke tenant?** → MCM2.
3. **Allebei?** → splits het. Het identiteitsdeel naar de provider, het
   toegangsdeel hierheen.
4. **Kan dit alleen bij deze ene provider?** → dan is het een ontwerpfout,
   tenzij het punt 4 hierboven is (federatie per tenant) en bewust zo bedoeld.

## Gevolgen

Wat dit oplevert: een zakelijke klant kan gevraagd worden welke IdP hij wil, en
het antwoord hoeft niet "Microsoft, anders werkt het niet" te zijn. De
leveranciersafhankelijkheid is een configuratiekeuze, geen architectuurfeit.

Wat het kost: de verleiding om iets snel op te lossen met een providerspecifieke
claim moet weerstaan worden. Op 2026-08-08 gebeurde dat één keer (de `idp`-eis
in 0023), en het duurde één dag voordat het teruggedraaid werd — niet omdat het
onveilig was, maar omdat het de verkeerde vraag beantwoordde én vastzette aan
een provider.

Wat er níét mee besloten is: dat Entra de eindkeuze is. Voor de doelgroep
— corporate IT met federatie-eisen — is het vandaag de beste keuze. Deze ADR
zorgt dat die uitspraak herzienbaar blijft.
