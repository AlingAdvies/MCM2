# ADR-005 — Node.js-versie: 24 (Active LTS)

- Status: Accepted, geïmplementeerd
- Datum: 2026-07-24
- Context: het oorspronkelijke implementatieplan noemde `node:20-alpine`. Bij uitvoering bleek Node.js 24 inmiddels de actieve LTS-versie, consistent met de Node-versie op de ontwikkelmachine (v24.13.1).
- Besluit: `node:24-alpine` als Docker-basisimage, consistent met de lokale ontwikkelomgeving.
- Alternatieven: Node 20 aanhouden zoals in het oorspronkelijke plan (verworpen — geen reden om een oudere LTS-versie te kiezen dan wat al lokaal in gebruik is; verkleint bovendien het onderhoudsvenster onnodig).
- Gevolgen: consistente Node-versie tussen lokale ontwikkeling en Docker voorkomt "werkt lokaal niet in Docker"-verschillen.
- Openstaand controlepunt: er is nog geen `.nvmrc` of `engines`-veld in `package.json` om deze versie ook lokaal expliciet af te dwingen — zie `docs/STATUS.md` en de roadmap (P0-categorie in de architectuurbeoordeling).
- Reviewmoment: bij de volgende Node.js-LTS-overgang, of bij het alsnog toevoegen van het `.nvmrc`/`engines`-veld.
- Bronnen: `docs/context/PROJECT-HISTORY-2026-07-24.md`; `docs/architecture-review/2026-07-24/07-decision-log.md` (oorspronkelijke ADR-010).
