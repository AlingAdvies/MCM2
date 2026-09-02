# MCM2 als twee producten: TD en AA — technisch advies

*Opgesteld 2026-09-01. Puur technische verkenning, geen besluit — input voor
een keuze die de eigenaar zelf maakt. Geen juridische/aandeelhouders-aspecten
(die zijn apart te behandelen).*

---

## 1. Probleemstelling

MCM2 is vandaag één multitenant platform: één codebase, één database-model
met tenant-isolatie via RLS, meerdere tenants (waaronder AlingAdvies en
Transdev) op dezelfde applicatie.

Er tekent zich een scenario af waarin dat niet meer volstaat:

- **Bizaline** ontwikkelt MCM2 feitelijk door als maatwerk voor één klant
  (Transdev), met klantspecifieke inrichting — vooral aan de voorkant.
- **AlingAdvies** wil MCM2 juist als generiek, verkoopbaar multitenant-product
  in de markt zetten, aan meerdere klanten, met een deels eigen roadmap.

Dat zijn geen twee tenants op één roadmap meer, maar **twee producten met
divergerende roadmaps**. De vraag is hoe je dat organiseert zonder dat de
stack onbeheersbaar wordt: hoe voorkom je dat een wijziging voor de ene kant
de andere kant breekt, en hoe voorkom je dubbel werk bij wat wél gedeeld
hoort te zijn.

---

## 2. Omstandigheden

**Voorziene roadmap-verdeling** (zoals door de eigenaar geschetst):

| Feature | TD | AA |
|---|---|---|
| Notificatiefunctionaliteit | ✅ | ✅ |
| Mailen vanuit TD-omgeving (eigen afzender/templates) | ✅ | — |
| Mailen vanuit generieke omgeving (à la jouwcontractmanager) | — | ✅ |
| NIS2-support (nis2-scaffold) | — | ✅ |
| Freemium / proefabonnement | — | ✅ |
| In-app vragenlijst-builder | — | ✅ |

Dit is geen zuiver frontend-verschil: NIS2-support en de vragenlijst-builder
zijn backend-features. Mail is een gedeeld concept met een verschillende
invulling per kant (afzenderdomein, templates).

**Bepalende randvoorwaarde**: de eigenaar voorziet dat hij zelf **de enige
onderhouder** van beide kanten wordt. Dat verandert het afwegingskader
wezenlijk — zie §4.

**Bestaande architectuur die al in deze richting wijst**:
- Drie-laags klantaanpassing (configuratie → feature flags → maatwerkmodule),
  vastgelegd in `c:\dev\CLAUDE.md`.
- `jouwcontractmanager` bestaat al als entry-tier sibling van `MVM_V2` — een
  precedent voor "gedeelde kern, aparte frontend-app".
- De NIS2-scaffold is al als losstaande module/ADR opgezet
  (`mcm2-nis2-scaffold-label-fundament`), niet verweven in de kern.
- Tenant-architectuur (RLS, `tenant_membership`, platformbeheerder-rol)
  bestaat al en is bewezen.

---

## 3. Advies

**Kernkeuze: één repository met een gedeelde backend-kern, AA-only
functionaliteit als losse uitschakelbare modules, en twee aparte
frontend-applicaties (TD en AA).**

Niet: twee losse backends. Niet: een fork op één moment in de tijd die
daarna zelfstandig verder leeft.

### 3.1 Backend: kern + modules, geen fork

- De **kern** bevat wat gedeeld is: tenant-model, sessie/RLS, en gedeelde
  features zoals notificaties.
- **AA-only functionaliteit** (NIS2, freemium/proefabbo, vragenlijst-builder)
  wordt gebouwd als losse modules naast de kern:
  - eigen schema-namespace (zoals NIS2 al deels heeft),
  - eigen routes onder een duidelijk, apart prefix,
  - eigen migratiebestanden, niet vermengd met kern-migraties,
  - een feature-vlag die de module voor een tenant/omgeving volledig
    uitschakelt — niet alleen een UI-element verbergen, maar de route/tabel
    ook daadwerkelijk niet actief.
- **Mail** krijgt een abstracte provider-interface in de kern
  (`MailProvider` o.i.d.); TD en AA hangen elk hun eigen implementatie
  erachter (eigen afzenderdomein, eigen templates). Zo wordt de
  mail-pijplijn één keer gebouwd, niet twee keer.

### 3.2 Frontend: twee aparte apps

- **TD-frontend**: Transdev-specifieke inrichting, blijft praten tegen
  dezelfde kern-API.
- **AA-frontend**: generiek, multitenant, roept ook de AA-only
  backend-modules aan.
- Precedent: dezelfde verhouding als `MVM_V2` ↔ `jouwcontractmanager`.

### 3.3 Eén repo, niet twee

Met één backend-kern en modulegrenzen is er geen technische noodzaak voor
een aparte TD-backend-repo. Eén repo betekent:
- een kern-bugfix (bijv. een RLS-fix) geldt voor beide kanten zonder dat hij
  handmatig overgezet moet worden,
- TD deployt eenvoudigweg een subset (kern + notificaties + TD-mail,
  zonder de AA-only modules).

Een aparte repo per kant is pas de betere keuze zodra een tweede partij
zelfstandig in de kern gaat schrijven met eigen, niet-afgestemde wijzigingen
— dat scenario is hier niet aan de orde (zie §4).

---

## 4. Waarom de "één onderhouder"-omstandigheid het advies verstevigt

Het risico dat normaal tegen "één repo, gedeelde kern" pleit, is een
**coördinatieprobleem tussen partijen**: fixes die niet consequent worden
overgezet, een team dat de modulegrens niet respecteert. Dat risico bestaat
vooral wanneer meerdere, onafhankelijke partijen aan dezelfde code werken.

Als de eigenaar zelf beide kanten onderhoudt, vervalt dat risico grotendeels
— er is niemand anders om mee af te stemmen. Wat overblijft is geen
coördinatie-, maar een **cognitieve-lastvraag**: kan één persoon onthouden
wat waar hangt, en voorkomen dat een TD-wijziging per ongeluk een AA-only
aanname raakt (of omgekeerd)?

Dat pleit er juist vóór om de modulegrenzen (schema-namespace, aparte
routes, aparte migraties, feature-vlaggen) net zo strikt te bewaken als
wanneer er wél een tweede partij zou zijn — niet als bescherming tussen
mensen, maar als bescherming tegen een toekomstige versie van jezelf die de
context niet meer scherp heeft. Discipline en tests vervangen hier wat een
aparte repo anders zou afdwingen.

---

## 5. Voorwaarden voor succes

1. **Elke AA-only module moet volledig uitschakelbaar zijn zonder de kern
   te raken.** Test dit letterlijk: een TD-deploy met de module uitgezet
   mag nergens een foutmelding, dode route, of ontbrekende tabel opleveren.
2. **Eigen migratiebestanden per module.** Een TD-deploy draait nooit een
   migratie die alleen voor een AA-only module bestaat.
3. **Architectuurgrens-tests zoals nu al bestaan** (bijv.
   `test/actor-context.e2e-spec.ts` dat het leverancierspad bewaakt) worden
   het patroon voor elke nieuwe modulegrens: een geautomatiseerde test die
   *bewijst* dat de grens niet doorbroken is, in plaats van vertrouwen op
   het eigen geheugen.
4. **Mail als interface, niet als kopie.** Vóór er een tweede
   mail-implementatie bijkomt, eerst de abstractie bouwen — niet twee keer
   dezelfde pijplijn met een andere afzender.
5. **Eigenaarschap per module expliciet vastleggen**, ook met één
   onderhouder — een korte notitie per module (waarvoor, welke tenant/kant,
   welke aannames) zodat een toekomstige sessie (van jou, of van Claude
   Code) niet hoeft te reconstrueren waarom een module bestaat.
6. **`verify:volledig` (of een equivalent) moet beide deploy-varianten
   dekken** — een testrun die alleen de AA-configuratie test, bewijst niets
   over de TD-configuratie met uitgeschakelde modules, en omgekeerd.
7. **Geen stilzwijgende kern-wijzigingen vanuit één kant.** Een wijziging in
   de kern (niet in een module) raakt per definitie beide producten — die
   wijziging verdient bewuste aandacht voor beide kanten, ook als er maar
   één onderhouder is.

---

## 6. Wat dit advies niet beslist

- De domeinnaam/merkkeuze (`clm.alingadvies.nl` vs. `clm.bizaline.com` vs.
  iets nieuws) — dat is een aparte DNS/Entra/certificaat-vraag.
- Eigenaarschap van IP en aandeelhoudersverhouding tussen Bizaline en
  AlingAdvies bij deze productsplitsing — een juridische vraag, geen
  technische.
- Het exacte moment en de volgorde waarin bestaande AA-only functionaliteit
  (NIS2-scaffold, andere) daadwerkelijk als losse module wordt
  losgetrokken uit de huidige kern.
