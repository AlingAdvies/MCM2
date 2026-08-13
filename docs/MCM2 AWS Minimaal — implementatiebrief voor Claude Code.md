# Implementatiebrief — MCM2/MVM naar AWS, scenario Minimaal

**Doel van dit document:** een uitvoerbare opdracht voor Claude Code om het MCM2-platform
(NestJS-backend + Next.js-frontend, huidig op server "saxombp") over te zetten naar AWS,
volgens het **Minimaal**-scenario. Dit is bewust géén volledige OTAP-migratie — dat komt in een
latere fase zodra er meerdere betalende tenants zijn. Zie "Opschaalpunten" onderaan voor de
concrete triggers daarvoor.

**Budgetkader: dit scenario moet binnen $20–30/maand AWS-kosten blijven.** Elke ontwerpkeuze die
dat overschrijdt (extra ALB, NAT Gateway, altijd-aan compute, RDS in plaats van Supabase) is
buiten scope voor deze fase — leg dat terug voor akkoord in plaats van het gewoon te bouwen.

---

## 1. Scope

### Wel doen
- Eén AWS-omgeving: **productie**, voor de eerste (kritieke) tenant.
- Backend en frontend als losse services op **AWS App Runner** (niet ECS Fargate — App Runner
  heeft geen ALB/NAT Gateway nodig en schaalt terug bij weinig verkeer, wat bij dit
  gebruikspatroon — lage basislast met pieken rond een surveyronde — veel goedkoper is).
- Database blijft **Supabase Postgres** (buiten de AWS-factuur). Geen migratie naar RDS in deze fase.
- Container images blijven bij **GitHub Container Registry (GHCR)**. Geen ECR.
- **S3** voor permanente documentopslag (vendor-uploads, compliance-bewijs). Dit moet vanaf dag 1
  goed staan, ook al is de rest minimaal — opslagkosten zijn hier verwaarloosbaar (< $1/maand),
  maar de structuur (bucketlayout, IAM, geen verval-/opruimregels) moet nu al compliance-proof zijn.
- **AWS Secrets Manager** voor productie-secrets (niet in plaintext env vars in App Runner-config).
- **CloudWatch Logs** met 30 dagen retentie, alleen voor productie.
- Custom domain `clm.alingadvies.nl` via App Runner custom domain + ACM (gratis TLS-certificaat).
- Een **build-time validatiestap** in de bestaande GitHub Actions-pipeline (zie §4) als vervanger
  voor een permanente staging-omgeving.
- **AWS Budget-alert** op $35/maand zodat een fout in de configuratie (bijv. per ongeluk een NAT
  Gateway aanmaken) meteen opvalt.

### Niet doen (expliciet buiten scope)
- Geen ECS Fargate, geen ALB, geen NAT Gateway.
- Geen RDS / geen Multi-AZ.
- Geen ECR.
- Geen CloudFront, geen WAF.
- Geen permanente staging- of acceptatie-omgeving.
- Geen wijziging aan Microsoft Entra External ID — authenticatie van de 35 interne gebruikers
  blijft ongewijzigd, dat loopt niet via AWS.
- Geen wijziging aan Resend voor e-mail (survey-uitnodigingen, herinneringen) — dat blijft zoals het is.

---

## 2. Te verifiëren vóór je begint

Voordat je infrastructuurcode schrijft, inventariseer het volgende in de repo en rapporteer het
terug (dit bepaalt namelijk of de scope hierboven nog klopt):

1. **Valkey en MinIO** — de lokale Docker Compose-stack gebruikt deze naast Postgres. Zoek uit:
   - Waarvoor wordt Valkey gebruikt (sessies, cache, queue, rate-limiting)? Is dat hard nodig in
     productie met 1 tenant, of kan de app zonder draaien (bijv. in-memory fallback)? Een
     ElastiCache-instantie zou een extra kostenpost zijn die nog niet in de raming staat — als
     Valkey productie-kritiek is, meld dat terug vóórdat je verder gaat, dan herzien we het budget.
   - Waarvoor wordt MinIO gebruikt — is dat puur de lokale S3-vervanger voor development, of zit
     er productielogica specifiek aan MinIO's API vast die niet 1-op-1 met S3 werkt?
2. **Health check endpoints** — heeft de NestJS-API een `/health`-endpoint dat App Runner kan
   gebruiken voor zijn health checks? Zo niet, voeg die toe (simpele 200 OK, geen DB-call nodig
   voor de basischeck).
3. **Huidige env vars / secrets** — maak een volledige lijst van alle environment variables die
   `api` en `frontend` nu gebruiken (uit `.env`, `docker-compose.yml`, of de huidige
   GitHub Actions-workflow). Verdeel ze in: (a) secrets → Secrets Manager, (b) configuratie
   → gewone App Runner environment variables.
4. **Bestaande GitHub Actions-workflow** — hoe wordt nu naar saxombp gedeployed? Dat patroon
   (build → push naar GHCR → deploy) blijft grotendeels intact; alleen de laatste stap
   ("deploy naar saxombp via SSH/Docker") wordt vervangen door "trigger App Runner deployment".
5. **Uploadpad in de code** — waar in de NestJS-code worden bestanden nu opgeslagen (lokaal
   filesystem, of al abstract via een storage-interface)? Als het nog lokaal filesystem is, is dit
   het moment om een S3-adapter te bouwen — dat moet sowieso, onafhankelijk van de infra-keuze.

---

## 3. Doelarchitectuur

```
GitHub (repo)
   │  git push → GitHub Actions
   ▼
Build api-image + frontend-image → push naar GHCR (ongewijzigd)
   │
   ▼
GitHub Actions: build-time validatiestap (§4)
   │  (alleen als groen)
   ▼
AWS App Runner — service "mcm2-api"        AWS App Runner — service "mcm2-frontend"
   0,25–0,5 vCPU / 0,5–1 GB, auto-scaling      0,25 vCPU / 0,5 GB, auto-scaling
   env vars uit Secrets Manager                 env vars (public config)
   │                                             │
   ▼                                             ▼
Supabase Postgres (ongewijzigd, buiten AWS)   S3 bucket (documentopslag)
                                               ACM-certificaat + custom domain
                                               clm.alingadvies.nl
CloudWatch Logs (30 dagen retentie)
AWS Budget-alert ($35/maand)
```

---

## 4. Build-time validatie in plaats van een permanente staging-omgeving

Doel: zekerheid vóór een deploy naar de echte tenant-data, zonder de vaste kosten van een 24/7
staging-omgeving.

- Voeg een job toe aan de bestaande GitHub Actions-workflow die, **vóór** de deploy-stap naar
  productie, de nieuwe images tijdelijk draait (bijv. via `docker compose up` in de CI-runner zelf,
  of — als je AWS-native wilt testen — een Fargate-taak die start, de healthcheck + een klein
  smoke-testscript draait, en daarna weer stopt). Dit kost alleen de paar minuten CI-tijd, geen
  doorlopende AWS-kosten.
- Smoke test moet minimaal controleren: API start zonder crash, `/health` geeft 200, frontend
  rendert de loginpagina, een testupload naar S3 (test-bucket of test-prefix) slaagt.
- Alleen bij een groene validatie mag de workflow doorgaan naar de App Runner-deploy.

---

## 5. Stappenplan

1. AWS-account aanmaken (indien nog niet gedaan) — activeer de 5 onboarding-taken voor het
   volledige $200-krediet (zie kostenraming, §7 "Jaar 1 vs jaar 2").
2. IAM: maak een dedicated deploy-rol/gebruiker met alleen de rechten die nodig zijn voor
   App Runner, S3, Secrets Manager en CloudWatch — geen breed AdministratorAccess-token in
   GitHub Secrets.
3. S3-bucket aanmaken voor documentopslag: geen lifecycle-regels, geen public access, versioning
   optioneel (zie kostenraming §5 — bewust simpel houden, kostenbesparing is hier verwaarloosbaar).
4. Secrets Manager: zet de secrets uit §2.3 hierin.
5. App Runner-service `mcm2-api`: koppel aan GHCR-image, configureer env vars + secrets,
   health check op `/health`, auto-scaling min 1 / max instellen op een laag plafond (bijv. 3) om
   onbedoelde kostenpieken te voorkomen.
6. App Runner-service `mcm2-frontend`: zelfde patroon, lichtere resource-toewijzing.
7. Custom domain: koppel `clm.alingadvies.nl` aan de frontend-service (en evt. een subpad of
   sub-subdomain voor de API), App Runner regelt het ACM-certificaat automatisch.
8. CloudWatch Logs: bevestig dat App Runner logs automatisch naar CloudWatch stuurt, zet
   retentie op 30 dagen.
9. AWS Budget: maak een budget-alert op $35/maand (alert bij 80% en 100%), e-mail naar
   [kees@alingadvies.nl](mailto:kees@alingadvies.nl).
10. Werk de GitHub Actions-workflow bij: build → push naar GHCR → build-time validatie (§4) →
    trigger App Runner-deploy (nieuwe image-versie) → wacht op gezonde health check → klaar.
11. Test de volledige flow end-to-end met de eerste tenant: interne gebruiker logt in via Entra
    External ID, verstuurt een surveyronde, een testvendor doorloopt de tokenlink-flow en uploadt
    een document, document is terug te vinden in S3.

---

## 6. Definition of done

- [ ] App draait volledig op AWS App Runner, bereikbaar via `clm.alingadvies.nl` met geldig TLS.
- [ ] Database blijft Supabase; geen nieuwe AWS-databasekosten.
- [ ] Documentupload en -opvraging werken end-to-end via S3.
- [ ] Secrets staan in Secrets Manager, niet in plaintext.
- [ ] GitHub Actions deployt automatisch bij een merge naar main, met een groene validatiestap
      vóórdat productie wordt geraakt.
- [ ] AWS Budget-alert staat actief op $35/maand.
- [ ] Eerste tenant heeft een volledige surveyronde succesvol doorlopen (interne gebruiker +
      minstens één vendor via tokenlink) op de AWS-omgeving.
- [ ] Werkelijke eerste-maand-AWS-factuur ligt binnen $20–30. Als dat niet zo is: rapporteer
      welke regel afwijkt vóór je verder bouwt.

---

## 7. Opschaalpunten (voor later, niet nu bouwen)

| Trigger | Verhoog naar |
|---|---|
| 2e of 3e betalende/serieuze tenant aan boord | Realistisch: volledige OTAP (acceptatie + staging + productie), migratie naar RDS Single-AZ |
| Contractuele SLA / downtime is onacceptabel | Volledig: RDS Multi-AZ op productie (+$25,66/maand) |
| Portaal krijgt veel publiek verkeer of wordt doelwit van misbruik | WAF (+$10/maand) en/of CloudFront |
| Meer dan ~15–25 tenants | Herzie database-instanceklasse (verbindingslimiet is de eerste praktische grens, geen netwerkcomponent) |

Volledige onderbouwing en cijfers: zie `AWS-kostenraming — drie scenario's` in dit project.
