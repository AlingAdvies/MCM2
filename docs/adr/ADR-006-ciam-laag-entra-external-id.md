# ADR-006 — Microsoft Entra External ID als CIAM-laag

> **Bestandsnaam gewijzigd op 2026-07-27.** Dit ADR heette `ADR-006-cognito-als-federatielaag.md`
> toen het oorspronkelijke besluit nog AWS Cognito was. Na de herziening (zie hieronder)
> dekte die naam de inhoud niet meer. Verwijzingen naar de oude bestandsnaam in
> historische documenten zijn bewust niet aangepast.

- Status: **Herzien op 2026-07-27. Cognito-spoor stopgezet vóór productieopzet; Microsoft Entra External ID is het nieuwe besluit.**
- Datum: oorspronkelijk besluit 2026-07-24 (Cognito), herzien 2026-07-27
- Context: authenticatie voor interne gebruikers (Transdev-beheerders, en op termijn mogelijk beheerders van andere klant-tenants) moet tegen de identity-provider(s) van de klantorganisatie werken. MCM2 is een multi-tenant SaaS-platform (MCM2-CLAUDE.md §2); welke identity-provider(s) toekomstige klanten gebruiken, staat niet vast — vermoedelijk overwegend Microsoft Entra ID, maar een niet-Microsoft-klant (bv. Google Workspace) is niet uit te sluiten.

## Herziening: waarom Cognito is losgelaten

Het oorspronkelijke besluit (2026-07-24) koos AWS Cognito als federatielaag vóór Entra ID. Bij de uitvoering (Issue #4/#7, 2026-07-27) kwamen twee bevindingen naar boven die dit besluit heroverwegen:

1. **Onnodige cross-cloud complexiteit.** Cognito + Entra-federatie voegt een volledige tweede cloudleverancier (AWS) en een apart AWS-account toe, puur voor identity — met eigen billing-relatie, eigen IAM, en een federatiekoppeling die in twee systemen tegelijk synchroon gehouden moet worden (redirect-URI's, secrets). Dit correspondeerde niet met de al bredere platformrichting (zie `Platform-Transitie/2026-03-30_platform-transitie_architectuur-migratie.md`: MVM_V2 is uitgegaan van rechtstreeks "Microsoft Entra ID — MSAL + JWT", zonder Cognito-tussenlaag).
2. **Cognito's enige onderscheidende waarde (multi-IdP-flexibiliteit) is geen unieke Cognito-eigenschap.** De oorspronkelijke motivatie ("niet vastzitten aan Entra ID als enige IdP") geldt evengoed voor Microsoft Entra External ID: ook dat is een generieke OIDC/SAML-broker die met Entra ID, Google, of iedere andere OIDC/SAML-IdP kan federeren. Er was geen Cognito-specifieke sterkte die verloren gaat.

Tegelijk is **rechtstreeks, kaal Entra ID** (zoals het 2026-03-30-platformdocument voorstelde) ook niet voldoende, om een reden die dat document niet behandelt: MCM2's multi-tenant-toekomst is qua identity-providers onzeker (zie vraag hieronder), en rechtstreeks Entra ID kan geen niet-Microsoft-klant bedienen zonder een tweede auth-pad te bouwen. Een CIAM-laag housing meerdere IdP's achter één consistente interface blijft dus gewenst — alleen niet via AWS Cognito.

## Besluit

Authenticatie voor interne beheerders wordt gebouwd tegen **Microsoft Entra External ID** (voorheen Azure AD B2C) als CIAM-laag, niet tegen AWS Cognito en niet rechtstreeks kaal tegen Entra ID.

- Entra External ID federeert met Entra ID (en desgewenst later Google Workspace of andere OIDC/SAML-IdP's) binnen hetzelfde Microsoft-ecosysteem — geen cross-cloud federatie, geen los AWS-account.
- Voor de Transdev-pilot: `alingadvies.nl` blijft de voorbeeld-/testtenant (zelfde beperking als bij het Cognito-spoor — geen toegang tot een Transdev-tenant). Voor de federatie is een **nieuwe** app-registratie aangemaakt in `alingadvies.nl` (`mcm2ciam-federation-trust`, client ID `aab9af4b-ae9f-4a30-945f-4ed199879a83`), omdat Microsoft's documentatie specifieke redirect-URI's (`.../federation/oauth2`) voorschrijft die niet overeenkwamen met de Cognito-opzet. De oude registratie `MCM2-Cognito-Federation` (`d369dcf9-26ec-4b6d-8a58-911884891107`) is daarmee ongebruikt en kan worden opgeruimd.
- Het AWS-account `727732213368` (tijdelijk aangemaakt voor de Cognito-proof-of-concept) is niet langer nodig voor identity. Er is geen Cognito User Pool aangemaakt (de opzet is gestopt vóór dat punt), dus er is niets af te breken of te migreren.

## Alternatieven (afgewogen op 2026-07-27)

| Optie | Verworpen omdat |
|---|---|
| AWS Cognito + Entra-federatie (oorspronkelijk ADR-006) | Onnodige tweede cloudleverancier voor identity; geen unieke sterkte t.o.v. Entra External ID |
| Rechtstreeks Entra ID/MSAL, geen CIAM-laag | Kan geen niet-Microsoft-klant bedienen zonder herbouw; MCM2's multi-tenant-toekomst qua IdP is onzeker, niet aantoonbaar Microsoft-only |
| Auth0 | Volwassen alternatief, maar voegt weer een derde partij toe zonder aantoonbaar voordeel boven Entra External ID gegeven de al bestaande Microsoft/Azure-voetafdruk (MVM_V2 draait op Azure App Service) |
| Keycloak (self-hosted) | Volledige controle en EU-dataresidentie triviaal, maar verschuift onderhoudslast (patches, uptime, beheer) naar het project zonder aantoonbare noodzaak — in strijd met MCM2-CLAUDE.md §8 ("laagste langetermijnbeheerlast") |

## Wat dit niet oplost

Dit ADR gaat uitsluitend over de **interne beheerder**-authenticatie (Issue #7, spoor 1). Het tokengebaseerde, accountloze mechanisme voor **externe leveranciers** (Issue #7, spoor 2) staat hier volledig los van — een CIAM-laag lost dat niet op, want leveranciers hebben geen Entra ID/Google-account bij de klantorganisatie. Dat mechanisme wordt apart ontworpen en gebouwd.

- Gevolgen: de proof-of-concept (Entra External ID-tenant/directory aanmaken, koppelen aan `alingadvies.nl` als externe IdP, App-registratie voor MCM2) moet nog gebouwd worden. Zie `docs/STATUS.md` voor de actuele voortgang.
- Reviewmoment: zodra de proof-of-concept werkt, en opnieuw vóór een tweede klant-tenant wordt aangesloten of vóór de daadwerkelijke Transdev-tenant gekoppeld wordt.
- Bronnen: `docs/architecture-review/2026-07-24/08-transdev-mvp-scope.md` (OV-1, oorspronkelijk tweesporenontwerp), `docs/archive/06-prioritized-roadmap-2026-07-24-pre-issues.md` (BP0/BP3), `docs/context/PROJECT-HISTORY-2026-07-24.md`, GitHub Issue #4 en #7, `C:\Users\cmali\OneDrive - Aling Advies\AI-Workspace\Bizaline\Platform-Transitie\2026-03-30_platform-transitie_architectuur-migratie.md` (bredere platformrichting, gedeeltelijk gedateerd — ging destijds niet in op MCM2's multi-tenant-IdP-onzekerheid).
