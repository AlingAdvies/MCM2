# ADR 0002 — Proeftijd-model in plaats van permanente freemium-gating

**Status:** bevestigd — 24-08-2026 (exacte parameters nog open, zie `business-model.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\))

## Context

Eerste opzet gebruikte een klassiek freemium-model: basisfunctionaliteit permanent gratis, bewijsstukkenbeheer/audit trail/rapportage permanent achter een betaalmuur. Bij nader inzien is aantoonbaarheid (audit trail, bewijs, rapportage) juist het onderscheidende kenmerk van het product ten opzichte van een eigen excel — dat kenmerk permanent gratis achterwege laten betekent dat de gratis versie functioneel niet te onderscheiden is van de excel.

## Beslissing

Geen permanente freemium-gating. In plaats daarvan: een proefperiode van 30 dagen met volledige functiediepte (inclusief bewijs en auditrapport), begrensd door een beperkt aantal leveranciers in plaats van door functiebeperking.

## Reden

Zo ervaart een prospect het complete, echte verschil met een excel binnen de proef. De begrenzing op leveranciersaantal (in plaats van alleen op tijd) voorkomt dat iemand het hele leveranciersregister gratis afhandelt binnen één proefvenster — NIS2 raakt de hele keten, dus opschalen naar meer leveranciers blijft de natuurlijke aanleiding om te betalen.

## Consequenties

- De eerdere per-blok "v1/gratis vs. premium"-labels zijn vervallen (zie `../roadmap.md`).
- Blok 9 (normenkader-configuratie) blijft als aparte, bewuste scope-keuze buiten v1 — los van dit besluit, zie `../blocks/09-normenkader.md`.
- Open: exacte leverancierslimiet tijdens de proef, en of rapport-export sowieso een betaalde actie is ongeacht proefstatus. Vastleggen zodra besloten, niet stilzwijgend invullen tijdens de bouw.

## Zie ook

`business-model.md` (intern document, buiten de publieke repo: OneDrive\MCM2-klantdata\_platform\nis2\)
