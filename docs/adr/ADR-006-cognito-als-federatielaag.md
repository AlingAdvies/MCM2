# ADR-006 — AWS Cognito als federatielaag vóór Entra ID

- Status: **Accepted als architectuurprincipe — de concrete uitvoering voor de Transdev-pilot is nog niet afgerond.** Dit ADR legt het principe vast, niet een reeds werkende implementatie.
- Datum: oorspronkelijk besluit 2026-07-24, uitvoeringsstatus bijgewerkt tijdens deze contextherstructurering
- Context: authenticatie voor interne gebruikers (Transdev-beheerders) moet uiteindelijk tegen Microsoft Entra ID werken (Transdev is een Microsoft-tenant-organisatie). Rechtstreeks tegen Entra ID/MSAL bouwen en er later een federatiebroker voor zetten zou een herbouw zijn.
- Besluit: authenticatie wordt gebouwd tegen AWS Cognito als federatielaag, niet rechtstreeks tegen Entra ID. Cognito routeert Microsoft-login (SAML/OIDC) door en geeft zelf het JWT uit — dit vervangt Entra ID niet, het maakt Entra ID één geconfigureerde koppeling in plaats van hardgecodeerd de enige optie.
- Alternatieven: rechtstreeks tegen Entra ID/MSAL bouwen (verworpen — herbouw nodig zodra een tweede identity-provider ooit nodig is); een tijdelijk vereenvoudigd mechanisme permanent aanhouden (verworpen als structurele oplossing — wel acceptabel als **tijdelijke, gedateerde** pilot-uitzondering, zie hieronder).

## Actuele uitvoeringsstatus (2026-07-24) — nog niet afgerond

Voor de Transdev-survey-pilot specifiek is een tweesporenontwerp voorgesteld, nog niet uitgevoerd:
- **Spoor A (voorkeur, nog niet uitgevoerd):** Cognito User Pool + Entra ID-federatie testen met een Microsoft-zakelijk account van de projecteigenaar, waarvan nog niet bevestigd is of het account daadwerkelijk voldoende beheerdersrechten heeft in de bijbehorende Azure AD-tenant.
- **Spoor B (tijdelijke fallback, alleen indien Spoor A niet haalbaar is binnen de deadline):** een eenvoudiger, tijdelijk mechanisme met een expliciete, gedateerde einddatum waarop dit alsnog naar Spoor A moet zijn omgezet.

Dit ADR legt vast **dát** Cognito het architectuurprincipe is — het legt niet vast dat de federatie al werkt. Zie `docs/STATUS.md` voor de actuele voortgang van deze spike.

- Gevolgen: zolang de uitvoering niet is afgerond, blijft de vraag "hoe authenticeert de Transdev-beheerder nu daadwerkelijk" een open, expliciet te beantwoorden punt (zie ook P0 in `docs/STATUS.md` over tenantcontext-verificatie in het algemeen — dit ADR gaat over de identity-provider-keuze, P0 gaat over hoe de tenantcontext daaruit wordt afgeleid).
- Reviewmoment: zodra de Spoor A/B-keuze is gemaakt voor de Transdev-pilot, en opnieuw vóór een tweede tenant/klant wordt aangesloten.
- Bronnen: `docs/architecture-review/2026-07-24/08-transdev-mvp-scope.md` (OV-1 en het tweesporenontwerp), `06-prioritized-roadmap.md` (BP0/BP3), `docs/context/PROJECT-HISTORY-2026-07-24.md`.
