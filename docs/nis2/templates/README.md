# NIS2-templates — staan niet in deze repo

Het SC10-concepttemplate (`sc10-basic-concept-v0.json`) staat in
`C:\Users\cmali\OneDrive - Aling Advies\MCM2-klantdata\_platform\nis2\`.

Reden (14-10-2026): deze repo is publiek, en het template volgt de
maatregelstructuur van de SC-documenten. Op 15-10-2026 besloot de eigenaar
dat het auteursrechtpunt uit `../decisions/0006-transdev-geen-voorwaarde.md`
niet van toepassing is; het template mag dus naar productie, maar blijft
voorlopig buiten de repo. `.gitignore` weert `*.json` in deze map.

Laden per tenant. Een beschermde database (zoals productie) vraagt bewust
`--extern`:

    npm run seed:vragenlijsten -- <tenant-uuid> "<absoluut pad naar het json-bestand>"

## Ook buiten de repo: twee interne documenten

In dezelfde OneDrive-map staan `business-model.md` (verdienmodel) en
`marktsignalen-ncsc-2026-10.md` (signalen uit een NCSC-maillijst). Besluit
eigenaar 15-10-2026: niet in deze publieke repo. Verwijzingen in de
documenten hier noemen ze als "intern document".
