# Reactie op de review van 2026-08-08

**Betreft:** `review-tenants-gebruikers-en-platformbeheer.md`
**Verwerkt in:** `tenants-gebruikers-en-platformbeheer.md` (§2c, §6, §7)

---

## Kort

Zes van de zeven punten zijn overgenomen. Eén bevinding — de zwaarste van de
review — bleek al opgelost te zijn, en dat is mijn fout: de waarborg stond
nergens in het document, dus een reviewer neemt terecht aan dat hij ontbreekt.

Alles hieronder is **geverifieerd tegen de productiedatabase**, niet uit de
migraties overgeschreven.

---

## Overgenomen

### 1. Vervaltermijn op de wachtende rij (9.1)

Raak en belangrijk. Een gebruiker zonder `oid` was onbeperkt koppelbaar; dat
venster hoort te sluiten.

Verwerkt als **vijfde voorwaarde** in stap 3: een kolom `koppelbaar_tot` op
`clm."user"`, standaard 90 dagen. Verloopt hij, dan moet de platformbeheerder de
uitnodiging opnieuw zetten — een zichtbare handeling in plaats van een deur die
open blijft staan.

### 2. Verval van support-toegang per verzoek handhaven (9.5)

De scherpste vraag van de review, en ik had hem niet beantwoord. Als
`verloopt_op` alleen bij het aanmaken van de sessie wordt getoetst, overleeft
een lopende sessie het verval — en dan is "acht uur" een belofte die de eerste
keer al niet klopt.

Nu **stap 4**: de toets hoort in `sessie_oplossen()`, niet in de applicatielaag.
Daar is het één vergeten filter van een lek verwijderd.

### 3. De duur instelbaar maken (9.3)

Overgenomen. Bijstellen van acht uur mag geen migratie kosten.

### 4. `search_path` en `EXECUTE` als test, niet als tekst (9.2, 9.4)

Hier zit de kern van de review, ook al klopte de aanleiding niet (zie hieronder).
De rechtencontrole uit stap 2 dekte alleen tabelrechten. Dat is de helft.

Stap 2 is uitgebreid tot **drie** dingen: tabelrechten, `search_path` per
`SECURITY DEFINER`-functie, en `EXECUTE`-rechten op die functies. Een nieuwe
tabel of functie zonder regel in het contract maakt de test rood.

Dat is precies het punt: vandaag is `search_path` een eigenschap van vijf
migraties die iemand bij een zesde kan vergeten.

### 5. Offboarding als expliciete niet-scope (9.5)

Volledig gemist in het oorspronkelijke document. Nu benoemd in §7 — met de
kanttekening dat dit **de zwakste uitstelbeslissing** is: bij één eigen tenant
onschuldig, maar "wie mocht hier ooit werken en mag dat nog" is een vraag die
een auditor stelt zodra er een echte klant is.

### 6. Escalatiepad en bootstrap-grens (9.3, 9.5)

Allebei benoemd in §7. Een supportmedewerker die niets mag wijzigen heeft geen
volgende stap binnen de app; een tweede platformbeheerder kan alleen via het
inrichtingsscript. Geen van beide is nu een probleem, allebei zijn het het
eerste wat opvalt zodra de schaal verandert.

---

## Niet overgenomen — met bewijs

### `search_path` op de `SECURITY DEFINER`-functies was al geregeld

De review noemt dit het grootste concrete gat. Het patroon is reëel en de
bronnen kloppen, maar het raakt dit systeem niet. Gemeten op productie:

```
proname                 definer  config                      execute
gebruiker_bij_subject   true     search_path=clm, pg_temp    clm_api, clm_admin, clm_migrator
sessie_aanmaken         true     search_path=clm, pg_temp    idem
sessie_oplossen         true     search_path=clm, pg_temp    idem
sessie_beeindigen       true     search_path=clm, pg_temp    idem
resolve_survey_token    true     search_path=clm, pg_temp    idem
```

Alle vijf hebben een vaste `search_path`; geen enkele staat op de default, dus
`PUBLIC` is er overal af. Migratie 0009 legt de reden zelfs expliciet vast:
*"`SET search_path` is niet optioneel bij SECURITY DEFINER."*

**Dat de reviewer dit als gat aanmerkte, is mijn fout en niet de zijne.** Het
document beschreef de waarborg nergens. Nu wel — §2c.

De aanbeveling die wél overeind blijft is overgenomen: maak er een test van.

### De hoofdletterbug stond niet in §6 omdat hij al opgelost was

Migratie 0021, gedraaid op productie en teruggelezen op 2026-08-08. Het
document zei "gevonden" zonder erbij te zetten dat hij ook gerepareerd was.
Staat nu in §2c.

---

## De les

Twee van de drie "gaten" waren geen gaten maar **ongedocumenteerde
beslissingen**. Dat is geen toeval: het document beschreef wat er moest
gebeuren, niet wat er al goed stond. Voor een lezer die het systeem kent is dat
efficiënt; voor een reviewer is het misleidend.

Vandaar §2c, "Waarborgen die er al zijn". Een volgende reviewer kan daarmee
voortbouwen in plaats van hetzelfde opnieuw vinden.

Dat sluit aan bij de aanleiding van dit hele document: drie dingen gingen op
2026-08-08 mis omdat ze werden aangenomen in plaats van gemeten. Een waarborg
die nergens staat, is voor iedereen behalve de auteur hetzelfde als een
waarborg die er niet is.
