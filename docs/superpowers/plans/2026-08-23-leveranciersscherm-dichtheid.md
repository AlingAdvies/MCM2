# Leveranciersscherm — dichtheid, modal, uitklapbare contracten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Herzie `/beheer/leveranciers/[id]` (badge-strip + twee kolommen,
modal voor contactpersoon, uitklapbare contractrij, expliciet
wachtlijst-label, urgentiekleur op de einddatum) conform
`docs/superpowers/specs/2026-08-23-leveranciersscherm-dichtheid-design.md`.

**Architecture:** Puur frontend, `MCM2-frontend`-repo, geen backend- of
databasewijziging. Het bestaande 1913-regelige
`src/app/beheer/leveranciers/[id]/page.tsx` wordt opgesplitst: de
Contactpersonen- en Contracten-secties verhuizen naar eigen bestanden onder
`src/app/beheer/leveranciers/[id]/`, met een nieuwe gedeelde
`ContactpersoonModal`-component. De hoofdpagina wordt dun: hij haalt de
vendor op en rendert de badge-strip + twee kolommen met de uitgesplitste
secties erin.

**Tech Stack:** Next.js 15 App Router, React (client components,
`'use client'`), Tailwind, bestaande services (`vendorService`,
`contractService`) — ongewijzigd aangeroepen.

---

## Bestandsoverzicht

| Bestand | Actie | Verantwoordelijkheid |
|---|---|---|
| `src/app/beheer/leveranciers/[id]/page.tsx` | Herschrijven (ingekort) | Data ophalen, badge-strip, twee-koloms layout, scroll-naar-contract |
| `src/app/beheer/leveranciers/[id]/Stamgegevens.tsx` | Nieuw | Compacte stamgegevens-kaart (zonder classificatie-fieldset, die gaat naar de badge-strip) |
| `src/app/beheer/leveranciers/[id]/ClassificatieBadges.tsx` | Nieuw | Badge-strip: naam, compliance/kritiek/categorie, klikbaar naar bewerken |
| `src/app/beheer/leveranciers/[id]/ContactpersoonModal.tsx` | Nieuw | Gedeelde modal voor toevoegen én bewerken van een contactpersoon |
| `src/app/beheer/leveranciers/[id]/Contactpersonen.tsx` | Nieuw (verplaatst) | Compacte contactenlijst + "+ toevoegen"-knop die de modal opent |
| `src/app/beheer/leveranciers/[id]/Contracten.tsx` | Nieuw (verplaatst) | Contractentabel met uitklapbare rijen, urgentiekleur, wachtlijst-label |
| `e2e/vendor-detail.spec.ts` | Wijzigen | Testid's/selectors aanpassen aan modal en badge-strip |
| `e2e/contracten.spec.ts` | Wijzigen | Testid's/selectors aanpassen aan uitklap i.p.v. edit-knop |

---

### Task 1: Stamgegevens loskoppelen van classificatie, eigen bestand

**Files:**
- Create: `src/app/beheer/leveranciers/[id]/Stamgegevens.tsx`
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx:164-451` (huidige `Stamgegevens`-functie verwijderen na verplaatsing)

Het bestaande `Stamgegevens`-component (regel 164-451 in de huidige
`page.tsx`) doet nu twee dingen: het formulier voor naam/KvK/plaats/etc. én
het classificatie-`<fieldset>` (categorie/kritiek/compliance). Die twee
worden gesplitst: classificatie gaat naar `ClassificatieBadges.tsx` (Task 2),
de rest blijft hier maar compacter en zonder de `<fieldset>`.

- [ ] **Step 1: Maak `Stamgegevens.tsx` met de compacte kaart**

```tsx
'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { SchrijfResultaat, VendorDetail } from '@/core/models/vendor';
import { verwijderVendor, wijzigVendor } from '@/core/services/vendorService';
import { Veld } from '@/shared/components/Formuliervelden';

interface FormulierStaat {
  name: string;
  kvkNumber: string;
  vestigingsnummer: string;
  statutoryName: string;
  city: string;
  country: string;
  website: string;
}

function uitVendor(vendor: VendorDetail): FormulierStaat {
  return {
    name: vendor.name,
    kvkNumber: vendor.kvkNumber ?? '',
    vestigingsnummer: vendor.vestigingsnummer ?? '',
    statutoryName: vendor.statutoryName ?? '',
    city: vendor.city ?? '',
    country: vendor.country,
    website: vendor.website ?? '',
  };
}

/**
 * Compacte stamgegevens-kaart voor de linkerkolom.
 *
 * Classificatie (categorie/kritiek/compliance) staat hier bewust niet meer
 * bij — die verhuisde naar de badge-strip bovenaan de pagina
 * (`ClassificatieBadges`), zichtbaarder dan weggestopt in een fieldset.
 * Bewerken van die velden blijft mogelijk, alleen niet vanuit dit component.
 */
export function Stamgegevens({
  vendor,
  onOpgeslagen,
  onVerwijderd,
}: {
  vendor: VendorDetail;
  onOpgeslagen: (vendor: VendorDetail) => void;
  onVerwijderd: () => void;
}) {
  const [formulier, setFormulier] = useState<FormulierStaat>(() =>
    uitVendor(vendor),
  );
  const [bezig, setBezig] = useState(false);
  const [veldFout, setVeldFout] = useState<{
    veld: string;
    melding: string;
  } | null>(null);
  const [algemeneFout, setAlgemeneFout] = useState<string | null>(null);
  const [gelukt, setGelukt] = useState<string | null>(null);
  const [bevestigVerwijderen, setBevestigVerwijderen] = useState(false);

  function wijzigVeld(veld: keyof FormulierStaat, waarde: string) {
    setFormulier((vorig) => ({ ...vorig, [veld]: waarde }));
    setGelukt(null);
    if (veldFout && veldFout.veld === veld) {
      setVeldFout(null);
    }
  }

  async function opslaan(gebeurtenis: React.FormEvent) {
    gebeurtenis.preventDefault();

    setBezig(true);
    setVeldFout(null);
    setAlgemeneFout(null);
    setGelukt(null);

    const uitkomst = await wijzigVendor(vendor.vendorId, {
      name: formulier.name,
      kvkNumber: formulier.kvkNumber || null,
      vestigingsnummer: formulier.vestigingsnummer || null,
      statutoryName: formulier.statutoryName || null,
      city: formulier.city || null,
      country: formulier.country || null,
      website: formulier.website || null,
    });

    setBezig(false);

    if (uitkomst.ok) {
      onOpgeslagen(uitkomst.waarde);
      setGelukt('De wijzigingen zijn opgeslagen.');
      return;
    }

    if (uitkomst.soort === 'veld') {
      setVeldFout({ veld: uitkomst.veld, melding: uitkomst.melding });
    } else {
      setAlgemeneFout(uitkomst.melding);
    }
  }

  async function verwijderDeze() {
    setBezig(true);
    setAlgemeneFout(null);

    const uitkomst = await verwijderVendor(vendor.vendorId);

    setBezig(false);

    if (uitkomst.ok) {
      onVerwijderd();
      return;
    }

    setBevestigVerwijderen(false);
    setAlgemeneFout(uitkomst.melding);
  }

  return (
    <section
      aria-labelledby="stamgegevens-kop"
      className="rounded-lg border border-line bg-card p-4"
    >
      <h2
        id="stamgegevens-kop"
        className="mb-3 text-sm font-semibold text-brand-dark"
      >
        Stamgegevens
      </h2>

      <form onSubmit={opslaan} noValidate>
        <div className="space-y-2.5 text-[13px]">
          <Veld
            id="name"
            label="Naam"
            verplicht
            waarde={formulier.name}
            onWijzig={(w) => wijzigVeld('name', w)}
            fout={veldFout?.veld === 'name' ? veldFout.melding : undefined}
          />
          <Veld
            id="statutoryName"
            label="Statutaire naam"
            waarde={formulier.statutoryName}
            onWijzig={(w) => wijzigVeld('statutoryName', w)}
          />
          <Veld
            id="kvkNumber"
            label="KvK-nummer"
            hint="Acht cijfers"
            waarde={formulier.kvkNumber}
            onWijzig={(w) => wijzigVeld('kvkNumber', w)}
            fout={
              veldFout?.veld === 'kvkNumber' ? veldFout.melding : undefined
            }
          />
          <Veld
            id="vestigingsnummer"
            label="Vestigingsnummer"
            waarde={formulier.vestigingsnummer}
            onWijzig={(w) => wijzigVeld('vestigingsnummer', w)}
          />
          <Veld
            id="city"
            label="Plaats"
            waarde={formulier.city}
            onWijzig={(w) => wijzigVeld('city', w)}
          />
          <Veld
            id="country"
            label="Land"
            waarde={formulier.country}
            onWijzig={(w) => wijzigVeld('country', w)}
          />
          <Veld
            id="website"
            label="Website"
            waarde={formulier.website}
            onWijzig={(w) => wijzigVeld('website', w)}
          />
        </div>

        {algemeneFout && (
          <p
            role="alert"
            data-testid="algemene-fout"
            className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
          >
            {algemeneFout}
          </p>
        )}

        {gelukt && (
          <p
            role="status"
            data-testid="gelukt-melding"
            className="mt-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800"
          >
            {gelukt}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="submit"
            disabled={bezig}
            data-testid="opslaan"
            className="rounded bg-brand-primary px-4 py-1.5 text-xs font-medium text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {bezig ? 'Bezig…' : 'Opslaan'}
          </button>

          {bevestigVerwijderen ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-muted">Zeker weten?</span>
              <button
                type="button"
                onClick={() => void verwijderDeze()}
                disabled={bezig}
                data-testid="verwijder-bevestig"
                className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:brightness-95 disabled:opacity-60"
              >
                Ja
              </button>
              <button
                type="button"
                onClick={() => setBevestigVerwijderen(false)}
                className="rounded border border-line px-2.5 py-1 text-xs text-ink hover:bg-surface"
              >
                Nee
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setBevestigVerwijderen(true)}
              data-testid="verwijder-vendor"
              className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1 text-xs text-red-700 transition hover:bg-red-50"
            >
              <Trash2 size={12} /> Verwijderen
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/beheer/leveranciers/[id]/Stamgegevens.tsx
git commit -m "refactor(vendor): Stamgegevens als eigen, compact component zonder classificatie"
```

---

### Task 2: Badge-strip met classificatie, eigen bestand

**Files:**
- Create: `src/app/beheer/leveranciers/[id]/ClassificatieBadges.tsx`

Vervangt het `<fieldset>` uit de oude `Stamgegevens` (regel 343-382 van de
huidige `page.tsx`). Toont naam + drie badges op één regel; klik op een
badge opent een klein inline-bewerkformulier voor dat ene veld (geen aparte
modal nodig — het zijn drie eenvoudige keuzevelden).

- [ ] **Step 1: Maak `ClassificatieBadges.tsx`**

```tsx
'use client';

import { useState } from 'react';

import {
  CATEGORIEEN,
  COMPLIANCE_STATUS,
  CRITICALITY,
  keuzesMetHuidige,
} from '@/core/models/classificatie';
import type { VendorDetail } from '@/core/models/vendor';
import { wijzigVendor } from '@/core/services/vendorService';
import { Keuzeveld } from '@/shared/components/Formuliervelden';

const COMPLIANCE_KLEUR: Record<string, string> = {
  compliant: 'bg-green-100 text-green-800',
  niet_compliant: 'bg-red-100 text-red-800',
};

const COMPLIANCE_LABEL: Record<string, string> = {
  compliant: 'Compliant',
  niet_compliant: 'Niet-compliant',
};

/**
 * Badge-strip bovenaan het leveranciersscherm.
 *
 * Vervangt het classificatie-`<fieldset>` dat voorheen onderin Stamgegevens
 * stond. Compliance-status is hier het meest opvallende badge omdat het de
 * eerste vraag is die een contractbeheerder stelt — niet weggestopt in een
 * formulierveld.
 *
 * `scrollNaarContracten` (optioneel): wanneer gezet, scrollt een klik op de
 * compliance-badge naar de Contracten-sectie in plaats van het bewerkveld te
 * openen. Zie `page.tsx` voor de aanroep — dit is het doorklik-scenario uit
 * de spec (§6): "waar staat het contract waar dit over gaat?".
 */
export function ClassificatieBadges({
  vendor,
  onOpgeslagen,
  onComplianceKlik,
}: {
  vendor: VendorDetail;
  onOpgeslagen: (vendor: VendorDetail) => void;
  onComplianceKlik?: () => void;
}) {
  const [bewerktVeld, setBewerktVeld] = useState<
    'categoryCode' | 'businessCriticalityCode' | 'complianceStatusCode' | null
  >(null);
  const [bezig, setBezig] = useState(false);

  async function wijzig(
    veld: 'categoryCode' | 'businessCriticalityCode' | 'complianceStatusCode',
    waarde: string,
  ) {
    setBezig(true);
    const uitkomst = await wijzigVendor(vendor.vendorId, { [veld]: waarde });
    setBezig(false);

    if (uitkomst.ok) {
      onOpgeslagen(uitkomst.waarde);
      setBewerktVeld(null);
    }
  }

  if (bewerktVeld) {
    const configuratie = {
      categoryCode: {
        label: 'Categorie',
        keuzes: keuzesMetHuidige(CATEGORIEEN, vendor.categoryCode),
        waarde: vendor.categoryCode ?? '',
      },
      businessCriticalityCode: {
        label: 'Bedrijfskritiek',
        keuzes: keuzesMetHuidige(CRITICALITY, vendor.businessCriticalityCode),
        waarde: vendor.businessCriticalityCode ?? '',
      },
      complianceStatusCode: {
        label: 'Compliancestatus',
        keuzes: keuzesMetHuidige(
          COMPLIANCE_STATUS,
          vendor.complianceStatusCode,
        ),
        waarde: vendor.complianceStatusCode ?? '',
      },
    }[bewerktVeld];

    return (
      <div
        data-testid="classificatie-bewerk"
        className="mb-3 flex items-end gap-2 rounded-lg border border-line bg-card px-4 py-2.5"
      >
        <div className="w-56">
          <Keuzeveld
            id={`badge-${bewerktVeld}`}
            label={configuratie.label}
            waarde={configuratie.waarde}
            keuzes={configuratie.keuzes}
            onWijzig={(w) => void wijzig(bewerktVeld, w)}
          />
        </div>
        <button
          type="button"
          onClick={() => setBewerktVeld(null)}
          disabled={bezig}
          data-testid="annuleer-classificatie"
          className="rounded border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-surface"
        >
          Sluiten
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="badge-strip"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card px-4 py-2.5"
    >
      <span className="mr-1 text-[13px] font-semibold text-ink">
        {vendor.name}
      </span>

      <button
        type="button"
        data-testid="badge-compliance"
        onClick={() =>
          onComplianceKlik ? onComplianceKlik() : setBewerktVeld('complianceStatusCode')
        }
        className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
          COMPLIANCE_KLEUR[vendor.complianceStatusCode ?? ''] ??
          'bg-slate-100 text-slate-700'
        }`}
      >
        {COMPLIANCE_LABEL[vendor.complianceStatusCode ?? ''] ??
          'Geen compliancestatus'}
      </button>

      <button
        type="button"
        data-testid="badge-kritiek"
        onClick={() => setBewerktVeld('businessCriticalityCode')}
        className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-medium text-amber-800"
      >
        {vendor.businessCriticalityCode
          ? `Kritiek: ${vendor.businessCriticalityCode}`
          : 'Kritiek: onbekend'}
      </button>

      <button
        type="button"
        data-testid="badge-categorie"
        onClick={() => setBewerktVeld('categoryCode')}
        className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-medium text-indigo-800"
      >
        {vendor.categoryCode ?? 'Categorie onbekend'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/beheer/leveranciers/[id]/ClassificatieBadges.tsx
git commit -m "feat(vendor): badge-strip voor classificatie boven het leveranciersscherm"
```

---

### Task 3: `ContactpersoonModal` — gedeeld toevoegen/bewerken

**Files:**
- Create: `src/app/beheer/leveranciers/[id]/ContactpersoonModal.tsx`

Eén modal-component voor zowel aanmaken als bewerken — vervangt het
altijd-open formulier onderaan `Contactpersonen` (huidige regel 789-843) én
de inline bewerkvorm in `ContactRij` (huidige regel 549-617). Gestuurd door
een `contact`-prop: `null` = aanmaken, gevuld = bewerken (vooringevuld,
bewerken=aanmaken-symmetrie uit §1c).

- [ ] **Step 1: Maak `ContactpersoonModal.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';

import type { Contactpersoon } from '@/core/models/vendor';
import { voegContactToe, wijzigContact } from '@/core/services/vendorService';
import { Veld } from '@/shared/components/Formuliervelden';

interface ContactVelden {
  fullName: string;
  email: string;
  jobTitle: string;
  roleDescription: string;
}

const LEEG: ContactVelden = {
  fullName: '',
  email: '',
  jobTitle: '',
  roleDescription: '',
};

function uitContact(contact: Contactpersoon): ContactVelden {
  return {
    fullName: contact.fullName,
    email: contact.email ?? '',
    jobTitle: contact.jobTitle ?? '',
    roleDescription: contact.roleDescription ?? '',
  };
}

/**
 * Modal voor contactpersoon toevoegen of bewerken.
 *
 * Overgenomen patroon van MVM_V2 (`VendorContactsPanel.tsx`, `modalOpen` +
 * `editingId`): één modal in plaats van een altijd-open inline formulier
 * (het eerder overwogen "fold-out"-idee). `contact === null` is de
 * aanmaakstand; een gevulde `contact` is de bewerkstand, vooringevuld.
 */
export function ContactpersoonModal({
  open,
  vendorId,
  contact,
  onGesloten,
  onOpgeslagen,
}: {
  open: boolean;
  vendorId: string;
  contact: Contactpersoon | null;
  onGesloten: () => void;
  onOpgeslagen: () => void | Promise<void>;
}) {
  const [waarden, setWaarden] = useState<ContactVelden>(LEEG);
  const [bezig, setBezig] = useState(false);
  const [veldFout, setVeldFout] = useState<{
    veld: string;
    melding: string;
  } | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  // Bij elke keer openen (of wisselen tussen aanmaken/bewerken) opnieuw
  // vullen — anders toont een tweede bewerkronde de afgebroken invoer van
  // de vorige.
  useEffect(() => {
    if (open) {
      setWaarden(contact ? uitContact(contact) : LEEG);
      setVeldFout(null);
      setFout(null);
    }
  }, [open, contact]);

  if (!open) {
    return null;
  }

  async function bewaar(gebeurtenis: React.FormEvent) {
    gebeurtenis.preventDefault();
    setBezig(true);
    setVeldFout(null);
    setFout(null);

    const payload = {
      fullName: waarden.fullName,
      email: waarden.email.trim() || null,
      jobTitle: waarden.jobTitle.trim() || null,
      roleDescription: waarden.roleDescription.trim() || null,
    };

    const uitkomst = contact
      ? await wijzigContact(vendorId, contact.contactId, payload)
      : await voegContactToe(vendorId, payload);

    setBezig(false);

    if (uitkomst.ok) {
      await onOpgeslagen();
      onGesloten();
      return;
    }

    if (uitkomst.soort === 'veld') {
      setVeldFout({ veld: uitkomst.veld, melding: uitkomst.melding });
    } else {
      setFout(uitkomst.melding);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onGesloten}
    >
      <div
        role="dialog"
        aria-labelledby="contact-modal-titel"
        data-testid="contact-modal"
        className="w-full max-w-md rounded-lg bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="contact-modal-titel"
          className="mb-4 text-sm font-semibold text-brand-dark"
        >
          {contact ? 'Contactpersoon bewerken' : 'Contactpersoon toevoegen'}
        </h2>

        <form onSubmit={bewaar} noValidate>
          <div className="space-y-3">
            <Veld
              id="modal-contactNaam"
              label="Naam"
              verplicht
              waarde={waarden.fullName}
              onWijzig={(w) => setWaarden((v) => ({ ...v, fullName: w }))}
              fout={
                veldFout?.veld === 'contactNaam' ? veldFout.melding : undefined
              }
            />
            <Veld
              id="modal-contactEmail"
              label="E-mailadres"
              type="email"
              waarde={waarden.email}
              onWijzig={(w) => setWaarden((v) => ({ ...v, email: w }))}
              fout={
                veldFout?.veld === 'contactEmail'
                  ? veldFout.melding
                  : undefined
              }
            />
            <Veld
              id="modal-contactFunctie"
              label="Functie"
              waarde={waarden.jobTitle}
              onWijzig={(w) => setWaarden((v) => ({ ...v, jobTitle: w }))}
            />
            <Veld
              id="modal-contactNotitie"
              label="Notitie"
              waarde={waarden.roleDescription}
              onWijzig={(w) =>
                setWaarden((v) => ({ ...v, roleDescription: w }))
              }
            />
          </div>

          {fout && (
            <p
              role="alert"
              data-testid="contact-modal-fout"
              className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
            >
              {fout}
            </p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              disabled={bezig}
              data-testid="contact-modal-opslaan"
              className="rounded bg-brand-primary px-4 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bezig ? 'Bezig…' : contact ? 'Opslaan' : 'Toevoegen'}
            </button>
            <button
              type="button"
              onClick={onGesloten}
              data-testid="contact-modal-annuleer"
              className="rounded border border-line px-4 py-1.5 text-xs text-ink transition hover:bg-surface"
            >
              Annuleren
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/beheer/leveranciers/[id]/ContactpersoonModal.tsx
git commit -m "feat(vendor): ContactpersoonModal — gedeelde modal voor toevoegen en bewerken"
```

---

### Task 4: `Contactpersonen.tsx` — compacte lijst + modal-trigger

**Files:**
- Create: `src/app/beheer/leveranciers/[id]/Contactpersonen.tsx`

Vervangt het huidige `Contactpersonen`-component (regel 675-846) en
`ContactRij` (regel 474-673). Geen inline bewerkstand meer in de rij — een
klik op "bewerken" opent nu de modal uit Task 3.

- [ ] **Step 1: Maak `Contactpersonen.tsx`**

```tsx
'use client';

import { Pencil, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { Contactpersoon, VendorDetail } from '@/core/models/vendor';
import { verwijderContact, wijzigContact } from '@/core/services/vendorService';

import { ContactpersoonModal } from './ContactpersoonModal';

/**
 * Compacte contactenlijst voor de linkerkolom.
 *
 * Toevoegen en bewerken gaan allebei via `ContactpersoonModal` — geen
 * inline formulier meer, zie de spec §4 (modal i.p.v. fold-out, patroon
 * overgenomen van MVM_V2).
 */
export function Contactpersonen({
  vendor,
  onGewijzigd,
}: {
  vendor: VendorDetail;
  onGewijzigd: () => void | Promise<void>;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [bewerktContact, setBewerktContact] = useState<Contactpersoon | null>(
    null,
  );
  const [fout, setFout] = useState<string | null>(null);

  function openToevoegen() {
    setBewerktContact(null);
    setModalOpen(true);
  }

  function openBewerken(contact: Contactpersoon) {
    setBewerktContact(contact);
    setModalOpen(true);
  }

  async function maakPrimair(contact: Contactpersoon) {
    setFout(null);
    const uitkomst = await wijzigContact(vendor.vendorId, contact.contactId, {
      isPrimary: true,
    });

    if (uitkomst.ok) {
      await onGewijzigd();
    } else {
      setFout(uitkomst.melding);
    }
  }

  async function verwijderDeze(contact: Contactpersoon) {
    setFout(null);
    const uitkomst = await verwijderContact(vendor.vendorId, contact.contactId);

    if (uitkomst.ok) {
      await onGewijzigd();
    } else {
      setFout(uitkomst.melding);
    }
  }

  return (
    <section
      aria-labelledby="contacten-kop"
      className="rounded-lg border border-line bg-card p-4"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2
          id="contacten-kop"
          className="text-sm font-semibold text-brand-dark"
        >
          Contactpersonen{' '}
          <span
            data-testid="aantal-contacten"
            className="text-xs font-normal text-ink-muted"
          >
            ({vendor.contacten.length})
          </span>
        </h2>
        <button
          type="button"
          onClick={openToevoegen}
          data-testid="open-contact-modal"
          className="text-xs font-medium text-brand-primary hover:underline"
        >
          + toevoegen
        </button>
      </div>

      {vendor.contacten.length === 0 ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Er is nog geen contactpersoon. Zonder e-mailadres kan er geen
          vragenlijst verstuurd worden.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {vendor.contacten.map((contact) => (
            <li
              key={contact.contactId}
              data-testid="contact-rij"
              className="flex items-start justify-between gap-2 py-2 text-[12px]"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1 font-medium text-ink">
                  {contact.isPrimary && (
                    <Star
                      size={11}
                      className="flex-shrink-0 fill-brand-primary text-brand-primary"
                      aria-label="Primaire contactpersoon"
                    />
                  )}
                  {contact.fullName}
                </p>
                <p className="text-[11px] text-ink-muted">
                  {[contact.jobTitle, contact.email]
                    .filter(Boolean)
                    .join(' · ') || 'geen e-mailadres'}
                </p>
              </div>

              <div className="flex flex-shrink-0 items-center gap-1">
                {!contact.isPrimary && (
                  <button
                    type="button"
                    onClick={() => void maakPrimair(contact)}
                    data-testid="maak-primair"
                    className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink transition hover:bg-surface"
                  >
                    primair
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openBewerken(contact)}
                  aria-label={`${contact.fullName} bewerken`}
                  data-testid="bewerk-contact"
                  className="rounded border border-line p-1 text-ink transition hover:bg-surface"
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => void verwijderDeze(contact)}
                  aria-label={`${contact.fullName} verwijderen`}
                  data-testid="verwijder-contact"
                  className="rounded border border-line p-1 text-red-700 transition hover:bg-red-50"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {fout && (
        <p
          role="alert"
          data-testid="contact-fout"
          className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {fout}
        </p>
      )}

      <ContactpersoonModal
        open={modalOpen}
        vendorId={vendor.vendorId}
        contact={bewerktContact}
        onGesloten={() => setModalOpen(false)}
        onOpgeslagen={onGewijzigd}
      />
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/beheer/leveranciers/[id]/Contactpersonen.tsx
git commit -m "refactor(vendor): Contactpersonen compact, toevoegen/bewerken via modal"
```

---

### Task 5: Urgentiekleur op de einddatum

**Files:**
- Create: `src/app/beheer/leveranciers/[id]/contractUrgentie.ts`

Losse, kleine module met de drempellogica — apart testbaar, en herbruikbaar
zodra issue #174 de opzegtermijn-correctie toevoegt (dan wordt dit bestand
uitgebreid, niet vervangen).

- [ ] **Step 1: Maak `contractUrgentie.ts`**

```ts
/**
 * Urgentiekleur op een contract-einddatum.
 *
 * Tussenoplossing zonder opzegtermijn-correctie — zie issue #174. Zodra dat
 * veld bestaat, wordt hier de "verlengt automatisch"-waarschuwing
 * toegevoegd; deze functie blijft dan de kale-datum-drempel als fallback
 * voor contracten zonder ingevulde opzegtermijn.
 */

export const URGENTIE_DREMPEL_WAARSCHUWING_DAGEN = 90;
export const URGENTIE_DREMPEL_ALARM_DAGEN = 30;

export type ContractUrgentie = 'neutraal' | 'waarschuwing' | 'alarm';

/** Dagen tot (positief) of sinds (negatief) de einddatum. Null zonder datum. */
export function dagenTotEinde(endDate: string | null): number | null {
  if (!endDate) return null;
  const verschil =
    new Date(endDate).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.round(verschil / (1000 * 60 * 60 * 24));
}

export function contractUrgentie(endDate: string | null): ContractUrgentie {
  const dagen = dagenTotEinde(endDate);
  if (dagen === null) return 'neutraal';
  if (dagen <= URGENTIE_DREMPEL_ALARM_DAGEN) return 'alarm';
  if (dagen <= URGENTIE_DREMPEL_WAARSCHUWING_DAGEN) return 'waarschuwing';
  return 'neutraal';
}

export const URGENTIE_TEKSTKLEUR: Record<ContractUrgentie, string> = {
  neutraal: 'text-ink-muted',
  waarschuwing: 'text-amber-700',
  alarm: 'text-red-700',
};
```

- [ ] **Step 2: Schrijf een test voor de drempellogica**

Create: `src/app/beheer/leveranciers/[id]/contractUrgentie.spec.ts`

```ts
import { contractUrgentie, dagenTotEinde } from './contractUrgentie';

describe('contractUrgentie', () => {
  const vandaag = new Date();

  function datumOver(dagen: number): string {
    const d = new Date(vandaag);
    d.setDate(d.getDate() + dagen);
    return d.toISOString().slice(0, 10);
  }

  it('geeft neutraal zonder einddatum', () => {
    expect(contractUrgentie(null)).toBe('neutraal');
  });

  it('geeft neutraal ver in de toekomst', () => {
    expect(contractUrgentie(datumOver(120))).toBe('neutraal');
  });

  it('geeft waarschuwing binnen 90 dagen', () => {
    expect(contractUrgentie(datumOver(45))).toBe('waarschuwing');
  });

  it('geeft alarm binnen 30 dagen', () => {
    expect(contractUrgentie(datumOver(10))).toBe('alarm');
  });

  it('geeft alarm als de datum al verstreken is', () => {
    expect(contractUrgentie(datumOver(-5))).toBe('alarm');
  });

  it('dagenTotEinde is negatief voor een verstreken datum', () => {
    expect(dagenTotEinde(datumOver(-5))).toBeLessThan(0);
  });
});
```

- [ ] **Step 3: Draai de test, verwacht PASS**

Run: `npx jest contractUrgentie --config jest.config.js` (of het bestaande
testcommando uit `package.json` voor unittests — controleer eerst met
`(Get-Content package.json | ConvertFrom-Json).scripts` welk commando de
frontend-repo hiervoor heeft)

Expected: 6 passed

- [ ] **Step 4: Commit**

```bash
git add src/app/beheer/leveranciers/[id]/contractUrgentie.ts src/app/beheer/leveranciers/[id]/contractUrgentie.spec.ts
git commit -m "feat(contract): urgentiedrempels voor de einddatum, met tests"
```

---

### Task 6: `Contracten.tsx` — uitklapbare rij, wachtlijst-label, urgentiekleur

**Files:**
- Create: `src/app/beheer/leveranciers/[id]/Contracten.tsx`

Vervangt `Contracten`, `ContractRij`, `ContractFormuliervelden`,
`NieuwContractFormulier`, `SurveyTemplateKoppelingBlok`,
`EindeIndicator` (huidige regel 848-1855). De rij zelf is nu de trigger om
uit te klappen (geen edit-knop meer nodig om details te *zien* — wel blijft
er een expliciete edit-actie voor het *bewerken*, binnen de uitgeklapte
rij). Wachtlijst-status krijgt een tekstlabel i.p.v. een stille checkbox.

- [ ] **Step 1: Maak `Contracten.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Contract, ContractInvoer } from '@/core/models/contract';
import type { Contactpersoon } from '@/core/models/vendor';
import {
  haalContracten,
  haalGekoppeldeTemplates,
  haalSurveyTemplates,
  haalTenantGebruikers,
  maakContractAan,
  verwijderContract,
  wijzigContract,
  zetGekoppeldeTemplates,
} from '@/core/services/contractService';
import { voegContactToe } from '@/core/services/vendorService';
import { Keuzeveld, Veld } from '@/shared/components/Formuliervelden';
import Link from 'next/link';

import {
  contractUrgentie,
  dagenTotEinde,
  URGENTIE_TEKSTKLEUR,
} from './contractUrgentie';

const CONTRACT_STATUS_LABEL: Record<string, string> = {
  actief: 'Actief',
  verlopen: 'Verlopen',
  opgezegd: 'Opgezegd',
};

const CONTRACT_STATUS_KLEUR: Record<string, string> = {
  actief: 'bg-green-100 text-green-800',
  verlopen: 'bg-red-100 text-red-800',
  opgezegd: 'bg-slate-100 text-slate-700',
};

function EindeIndicator({ endDate }: { endDate: string | null }) {
  const dagen = dagenTotEinde(endDate);
  if (dagen === null) return null;

  const urgentie = contractUrgentie(endDate);
  const tekst =
    dagen < 0 ? `${Math.abs(dagen)}d verlopen` : `nog ${dagen}d`;

  if (urgentie === 'neutraal') return null;

  return (
    <span className={`block text-[10px] ${URGENTIE_TEKSTKLEUR[urgentie]}`}>
      {tekst}
    </span>
  );
}

function uitContract(contract: Contract): ContractInvoer {
  return {
    name: contract.name,
    contractNumber: contract.contractNumber ?? '',
    vendorContactId: contract.vendorContactId ?? '',
    ownerUserId: contract.ownerUserId ?? '',
    statusCode: contract.statusCode ?? '',
    valueEur: contract.valueEur ?? '',
    startDate: contract.startDate ?? '',
    endDate: contract.endDate ?? '',
    note: contract.note ?? '',
  };
}

/**
 * Contracten-sectie voor de rechterkolom.
 *
 * De rij is zelf de trigger om uit te klappen (§5 van de spec) — geen
 * aparte edit-knop meer om details te *bekijken*. Binnen de uitgeklapte rij
 * staat wel een expliciete "bewerken"-stand voor het wijzigen van velden.
 */
export function Contracten({
  vendorId,
  contactenVanVendor,
  onContactpersoonAangemaakt,
  scrollHaakId = 'contracten-sectie',
}: {
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  onContactpersoonAangemaakt: () => void | Promise<void>;
  scrollHaakId?: string;
}) {
  const [contracten, setContracten] = useState<Contract[]>([]);
  const [laden, setLaden] = useState(true);
  const [gebruikers, setGebruikers] = useState<
    { userId: string; naam: string }[]
  >([]);
  const [opengeklapt, setOpengeklapt] = useState<string | null>(null);

  const laad = useCallback(async () => {
    setLaden(true);
    try {
      const [c, g] = await Promise.all([
        haalContracten(vendorId),
        haalTenantGebruikers(),
      ]);
      setContracten(c);
      setGebruikers(g);
    } finally {
      setLaden(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void laad();
  }, [laad]);

  return (
    <section
      id={scrollHaakId}
      aria-labelledby="contracten-kop"
      className="overflow-hidden rounded-lg border border-line bg-card"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2
          id="contracten-kop"
          className="text-sm font-semibold text-brand-dark"
        >
          Contracten{' '}
          <span
            data-testid="aantal-contracten"
            className="text-xs font-normal text-ink-muted"
          >
            ({contracten.length})
          </span>
        </h2>
      </div>

      {laden && (
        <p className="px-4 py-4 text-xs text-ink-muted">Bezig met laden…</p>
      )}

      {!laden && contracten.length === 0 && (
        <p className="px-4 py-4 text-xs text-ink-muted">
          Er is nog geen contract bij deze leverancier.
        </p>
      )}

      {!laden && contracten.length > 0 && (
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[10px] uppercase tracking-wide text-ink-muted">
              <th className="px-4 py-2 font-medium">Contract</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Einddatum</th>
              <th className="px-4 py-2 font-medium">Beheerder</th>
            </tr>
          </thead>
          <tbody>
            {contracten.map((contract) => (
              <ContractRijen
                key={contract.contractId}
                contract={contract}
                vendorId={vendorId}
                contactenVanVendor={contactenVanVendor}
                gebruikers={gebruikers}
                opengeklapt={opengeklapt === contract.contractId}
                onKlik={() =>
                  setOpengeklapt((v) =>
                    v === contract.contractId ? null : contract.contractId,
                  )
                }
                onGewijzigd={laad}
                onContactpersoonAangemaakt={onContactpersoonAangemaakt}
              />
            ))}
          </tbody>
        </table>
      )}

      <div className="border-t border-line px-4 py-3">
        <NieuwContractFormulier
          vendorId={vendorId}
          contactenVanVendor={contactenVanVendor}
          gebruikers={gebruikers}
          onAangemaakt={laad}
          onContactpersoonAangemaakt={onContactpersoonAangemaakt}
        />
      </div>
    </section>
  );
}

function ContractRijen({
  contract,
  vendorId,
  contactenVanVendor,
  gebruikers,
  opengeklapt,
  onKlik,
  onGewijzigd,
  onContactpersoonAangemaakt,
}: {
  contract: Contract;
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  opengeklapt: boolean;
  onKlik: () => void;
  onGewijzigd: () => void | Promise<void>;
  onContactpersoonAangemaakt: () => void | Promise<void>;
}) {
  const [bewerkt, setBewerkt] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [veldFout, setVeldFout] = useState<{
    veld: string;
    melding: string;
  } | null>(null);
  const [bevestigVerwijderen, setBevestigVerwijderen] = useState(false);
  const [waarden, setWaarden] = useState<ContractInvoer>(() =>
    uitContract(contract),
  );

  function beginBewerken() {
    setWaarden(uitContract(contract));
    setFout(null);
    setVeldFout(null);
    setBewerkt(true);
  }

  async function bewaar(gebeurtenis: React.FormEvent) {
    gebeurtenis.preventDefault();
    setBezig(true);
    setFout(null);
    setVeldFout(null);

    const uitkomst = await wijzigContract(vendorId, contract.contractId, waarden);
    setBezig(false);

    if (uitkomst.ok) {
      setBewerkt(false);
      await onGewijzigd();
      return;
    }

    if (uitkomst.soort === 'veld') {
      setVeldFout({ veld: uitkomst.veld, melding: uitkomst.melding });
    } else {
      setFout(uitkomst.melding);
    }
  }

  async function verwijderDeze() {
    setBezig(true);
    const uitkomst = await verwijderContract(vendorId, contract.contractId);
    setBezig(false);

    if (uitkomst.ok) {
      await onGewijzigd();
      return;
    }
    setBevestigVerwijderen(false);
    setFout(uitkomst.melding);
  }

  return (
    <>
      <tr
        data-testid="contract-rij"
        onClick={onKlik}
        className="cursor-pointer border-b border-line last:border-0 hover:bg-surface"
      >
        <td className="px-4 py-2 font-medium text-ink">
          {opengeklapt ? '▼' : '▶'} {contract.name}
        </td>
        <td className="px-4 py-2">
          {contract.statusCode && (
            <span
              data-testid="contract-status"
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                CONTRACT_STATUS_KLEUR[contract.statusCode] ??
                'bg-slate-100 text-slate-700'
              }`}
            >
              {CONTRACT_STATUS_LABEL[contract.statusCode] ?? contract.statusCode}
            </span>
          )}
        </td>
        <td className="px-4 py-2">
          <span
            className={URGENTIE_TEKSTKLEUR[contractUrgentie(contract.endDate)]}
          >
            {contract.endDate ?? '—'}
          </span>
          <EindeIndicator endDate={contract.endDate} />
        </td>
        <td className="px-4 py-2 text-ink-muted">
          {contract.ownerGebruikerNaam ?? '—'}
        </td>
      </tr>

      {opengeklapt && (
        <tr data-testid="contract-detail">
          <td colSpan={4} className="bg-surface px-4 py-4">
            {!bewerkt ? (
              <div className="text-[12px]">
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <div>
                    <span className="text-ink-muted">Contractnummer</span>
                    <br />
                    {contract.contractNumber ?? '—'}
                  </div>
                  <div>
                    <span className="text-ink-muted">Begindatum</span>
                    <br />
                    {contract.startDate ?? '—'}
                  </div>
                  <div>
                    <span className="text-ink-muted">Contactpersoon</span>
                    <br />
                    {contract.vendorContactNaam ?? '—'}
                  </div>
                  <div>
                    <span className="text-ink-muted">Waarde (EUR)</span>
                    <br />
                    {contract.valueEur ?? '—'}
                  </div>
                  <div className="col-span-2">
                    <span className="text-ink-muted">Notitie</span>
                    <br />
                    {contract.note ?? '—'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={beginBewerken}
                    data-testid="bewerk-contract"
                    className="rounded border border-line px-2.5 py-1 text-xs text-ink hover:bg-surface"
                  >
                    Bewerken
                  </button>
                  {bevestigVerwijderen ? (
                    <>
                      <span className="text-xs text-ink-muted">Zeker?</span>
                      <button
                        type="button"
                        onClick={() => void verwijderDeze()}
                        disabled={bezig}
                        data-testid="verwijder-contract-bevestig"
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:brightness-95"
                      >
                        Ja
                      </button>
                      <button
                        type="button"
                        onClick={() => setBevestigVerwijderen(false)}
                        className="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-surface"
                      >
                        Nee
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBevestigVerwijderen(true)}
                      data-testid="verwijder-contract"
                      className="rounded border border-line px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Verwijderen
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={bewaar} noValidate>
                <ContractFormuliervelden
                  waarden={waarden}
                  onWijzig={setWaarden}
                  contactenVanVendor={contactenVanVendor}
                  gebruikers={gebruikers}
                  veldFout={veldFout}
                  idPrefix={`bewerk-${contract.contractId}`}
                />

                {fout && (
                  <p
                    role="alert"
                    data-testid="bewerk-contract-fout"
                    className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
                  >
                    {fout}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={bezig}
                    data-testid="bewaar-contract"
                    className="rounded bg-brand-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {bezig ? 'Bezig…' : 'Opslaan'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBewerkt(false)}
                    data-testid="annuleer-contract"
                    className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface"
                  >
                    Annuleren
                  </button>
                </div>
              </form>
            )}

            <SurveyTemplateKoppelingBlok
              vendorId={vendorId}
              contractId={contract.contractId}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function ContractFormuliervelden({
  waarden,
  onWijzig,
  contactenVanVendor,
  gebruikers,
  veldFout,
  idPrefix,
}: {
  waarden: ContractInvoer;
  onWijzig: (w: ContractInvoer) => void;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  veldFout: { veld: string; melding: string } | null;
  idPrefix: string;
}) {
  function veld<K extends keyof ContractInvoer>(sleutel: K, waarde: string) {
    onWijzig({ ...waarden, [sleutel]: waarde });
  }

  function foutVoor(naam: string): string | undefined {
    return veldFout?.veld === naam ? veldFout.melding : undefined;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Veld
        id={`${idPrefix}-name`}
        label="Naam"
        verplicht
        waarde={waarden.name ?? ''}
        onWijzig={(w) => veld('name', w)}
        fout={foutVoor('Naam')}
      />
      <Veld
        id={`${idPrefix}-contractNumber`}
        label="Contractnummer"
        waarde={waarden.contractNumber ?? ''}
        onWijzig={(w) => veld('contractNumber', w)}
        fout={foutVoor('Contractnummer')}
      />
      <Keuzeveld
        id={`${idPrefix}-statusCode`}
        label="Status"
        waarde={waarden.statusCode ?? ''}
        keuzes={[
          { code: 'actief', label: 'Actief' },
          { code: 'verlopen', label: 'Verlopen' },
          { code: 'opgezegd', label: 'Opgezegd' },
        ]}
        onWijzig={(w) => veld('statusCode', w)}
      />
      <Veld
        id={`${idPrefix}-startDate`}
        label="Begindatum"
        type="date"
        waarde={waarden.startDate ?? ''}
        onWijzig={(w) => veld('startDate', w)}
        fout={foutVoor('Begindatum')}
      />
      <Veld
        id={`${idPrefix}-endDate`}
        label="Einddatum"
        type="date"
        waarde={waarden.endDate ?? ''}
        onWijzig={(w) => veld('endDate', w)}
        fout={foutVoor('Einddatum')}
      />
      <Veld
        id={`${idPrefix}-valueEur`}
        label="Waarde (EUR)"
        waarde={waarden.valueEur ?? ''}
        onWijzig={(w) => veld('valueEur', w)}
        fout={foutVoor('Waarde')}
      />
      <Keuzeveld
        id={`${idPrefix}-vendorContactId`}
        label="Contactpersoon"
        waarde={waarden.vendorContactId ?? ''}
        keuzes={contactenVanVendor.map((c) => ({
          code: c.contactId,
          label: c.fullName,
        }))}
        onWijzig={(w) => veld('vendorContactId', w)}
      />
      <Keuzeveld
        id={`${idPrefix}-ownerUserId`}
        label="Contractbeheerder"
        waarde={waarden.ownerUserId ?? ''}
        keuzes={gebruikers.map((g) => ({ code: g.userId, label: g.naam }))}
        onWijzig={(w) => veld('ownerUserId', w)}
      />
      <div className="sm:col-span-3">
        <label
          htmlFor={`${idPrefix}-note`}
          className="mb-1 block text-xs font-medium text-ink"
        >
          Notitie
        </label>
        <textarea
          id={`${idPrefix}-note`}
          value={waarden.note ?? ''}
          onChange={(e) => veld('note', e.target.value)}
          rows={2}
          className="w-full rounded border border-line px-3 py-2 text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
        />
      </div>
    </div>
  );
}

function NieuwContractFormulier({
  vendorId,
  contactenVanVendor,
  gebruikers,
  onAangemaakt,
  onContactpersoonAangemaakt,
}: {
  vendorId: string;
  contactenVanVendor: Contactpersoon[];
  gebruikers: { userId: string; naam: string }[];
  onAangemaakt: () => void | Promise<void>;
  onContactpersoonAangemaakt: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [waarden, setWaarden] = useState<ContractInvoer>({});
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [veldFout, setVeldFout] = useState<{
    veld: string;
    melding: string;
  } | null>(null);

  async function maak(gebeurtenis: React.FormEvent) {
    gebeurtenis.preventDefault();
    setBezig(true);
    setFout(null);
    setVeldFout(null);

    const uitkomst = await maakContractAan(vendorId, waarden);
    setBezig(false);

    if (uitkomst.ok) {
      setWaarden({});
      setOpen(false);
      await onAangemaakt();
      return;
    }

    if (uitkomst.soort === 'veld') {
      setVeldFout({ veld: uitkomst.veld, melding: uitkomst.melding });
    } else {
      setFout(uitkomst.melding);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="open-nieuw-contract"
        className="text-xs font-medium text-brand-primary hover:underline"
      >
        + nieuw contract
      </button>
    );
  }

  return (
    <form onSubmit={maak} noValidate>
      <p className="mb-2 text-xs font-medium text-ink">Nieuw contract</p>
      <ContractFormuliervelden
        waarden={waarden}
        onWijzig={setWaarden}
        contactenVanVendor={contactenVanVendor}
        gebruikers={gebruikers}
        veldFout={veldFout}
        idPrefix="nieuw-contract"
      />

      {fout && (
        <p
          role="alert"
          data-testid="nieuw-contract-fout"
          className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {fout}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="submit"
          disabled={bezig}
          data-testid="voeg-contract-toe"
          className="rounded border border-brand-primary px-3 py-1.5 text-xs font-medium text-brand-primary hover:bg-brand-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {bezig ? 'Bezig…' : 'Toevoegen'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          data-testid="annuleer-nieuw-contract"
          className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface"
        >
          Annuleren
        </button>
      </div>
    </form>
  );
}

function SurveyTemplateKoppelingBlok({
  vendorId,
  contractId,
}: {
  vendorId: string;
  contractId: string;
}) {
  const [templates, setTemplates] = useState<
    { templateId: string; naam: string }[]
  >([]);
  const [gekoppeld, setGekoppeld] = useState<Set<string>>(new Set());
  const [wachtlijst, setWachtlijst] = useState<Set<string>>(new Set());
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [gelukt, setGelukt] = useState(false);

  useEffect(() => {
    let actief = true;

    void (async () => {
      setLaden(true);
      const [alle, koppeling] = await Promise.all([
        haalSurveyTemplates(),
        haalGekoppeldeTemplates(vendorId, contractId),
      ]);
      if (!actief) return;
      setTemplates(alle);
      setGekoppeld(new Set(koppeling.templateIds));
      setWachtlijst(new Set(koppeling.wachtlijstTemplateIds));
      setLaden(false);
    })();

    return () => {
      actief = false;
    };
  }, [vendorId, contractId]);

  function schakel(templateId: string) {
    setGelukt(false);
    setGekoppeld((vorig) => {
      const nieuw = new Set(vorig);
      if (nieuw.has(templateId)) {
        nieuw.delete(templateId);
        setWachtlijst((w) => {
          const nw = new Set(w);
          nw.delete(templateId);
          return nw;
        });
      } else {
        nieuw.add(templateId);
      }
      return nieuw;
    });
  }

  function schakelWachtlijst(templateId: string) {
    setGelukt(false);
    setWachtlijst((vorig) => {
      const nieuw = new Set(vorig);
      if (nieuw.has(templateId)) {
        nieuw.delete(templateId);
      } else {
        nieuw.add(templateId);
      }
      return nieuw;
    });
  }

  async function koppelen() {
    setBezig(true);
    setFout(null);
    setGelukt(false);

    const uitkomst = await zetGekoppeldeTemplates(vendorId, contractId, {
      templateIds: [...gekoppeld],
      wachtlijstTemplateIds: [...wachtlijst],
    });

    setBezig(false);

    if (uitkomst.ok) {
      setGelukt(true);
      return;
    }
    setFout(uitkomst.melding);
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="mb-2 text-xs font-medium text-ink">
        Van toepassing zijnde vragenlijst(en)
      </p>

      {laden && <p className="text-xs text-ink-muted">Bezig met laden…</p>}

      {!laden && templates.length === 0 && (
        <p className="text-xs text-ink-muted">
          Er zijn nog geen vragenlijsten aangemaakt.
        </p>
      )}

      {!laden && templates.length > 0 && (
        <div className="mb-3 flex flex-col gap-1.5">
          {templates.map((t) => {
            const isGekoppeld = gekoppeld.has(t.templateId);
            const opWachtlijst = wachtlijst.has(t.templateId);

            return (
              <div key={t.templateId} className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    data-testid="survey-template-checkbox"
                    checked={isGekoppeld}
                    onChange={() => schakel(t.templateId)}
                  />
                  {t.naam}
                </label>

                {isGekoppeld && (
                  <button
                    type="button"
                    onClick={() => schakelWachtlijst(t.templateId)}
                    data-testid="wachtlijst-label"
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      opWachtlijst
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    wachtlijst {opWachtlijst ? 'AAN' : 'UIT'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!laden &&
        [...gekoppeld].map((templateId) => {
          const template = templates.find((t) => t.templateId === templateId);
          if (!template) return null;

          return (
            <Link
              key={templateId}
              href={`/beheer/vragenlijsten/uitnodigen?leveranciers=${vendorId}&contractId=${contractId}&templateId=${templateId}`}
              data-testid="uitnodigen-vanuit-contract-knop"
              className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-brand-primary hover:underline"
            >
              → {template.naam} nu uitnodigen
            </Link>
          );
        })}

      {fout && (
        <p
          role="alert"
          data-testid="survey-koppeling-fout"
          className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {fout}
        </p>
      )}

      {gelukt && (
        <p
          role="status"
          data-testid="survey-koppeling-gelukt"
          className="mb-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-800"
        >
          Opgeslagen.
        </p>
      )}

      <button
        type="button"
        onClick={() => void koppelen()}
        disabled={bezig || laden}
        data-testid="koppel-survey-templates"
        className="rounded border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
      >
        {bezig ? 'Bezig…' : 'Vragenlijsten koppelen'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/beheer/leveranciers/[id]/Contracten.tsx
git commit -m "feat(contract): uitklapbare contractrij, wachtlijst-label, urgentiekleur op einddatum"
```

---

### Task 7: Hoofdpagina herschrijven — badge-strip, twee kolommen, scroll-naar-contract

**Files:**
- Modify: `src/app/beheer/leveranciers/[id]/page.tsx` (volledige herschrijving, was 1913 regels, wordt kort)

- [ ] **Step 1: Vervang de inhoud van `page.tsx`**

```tsx
'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { VendorDetail } from '@/core/models/vendor';
import { haalVendorDetail } from '@/core/services/vendorService';
import { AppLayout } from '@/shared/components/layout/AppLayout';
import { VendorUitvraagPaneel } from '@/shared/components/VendorUitvraagPaneel';
import { useParams, useRouter } from 'next/navigation';

import { ClassificatieBadges } from './ClassificatieBadges';
import { Contactpersonen } from './Contactpersonen';
import { Contracten } from './Contracten';
import { Stamgegevens } from './Stamgegevens';

const CONTRACTEN_SECTIE_ID = 'contracten-sectie';

/**
 * Eén leverancier: stamgegevens wijzigen en contactpersonen beheren.
 *
 * ── Een eigen pagina en geen uitklapper ───────────────────────────────────
 * `/beheer/leveranciers/[id]` is deelbaar als link, werkt met de terugknop van
 * de browser, en biedt ruimte voor wat er later bij komt. Zie
 * `docs/superpowers/specs/2026-08-23-leveranciersscherm-dichtheid-design.md`.
 *
 * ── Twee kolommen, badge-strip bovenaan ───────────────────────────────────
 * Vervangt de drie gestapelde `p-6`-kaarten (dichtheidsprobleem uit
 * "21 augustus III" punt 1) door een badge-strip met de kerngegevens en een
 * compacte linkerkolom (stamgegevens, contactpersonen) naast een brede
 * rechterkolom (contracten, uitvragen) — patroon overgenomen van MVM_V2 na
 * expliciete vergelijking, zie de spec.
 *
 * ── Geen tenant in de URL ─────────────────────────────────────────────────
 * Alleen het vendor-id. De backend leidt de tenant af uit het sessiecookie en
 * geeft 404 wanneer dat id bij een andere tenant hoort. Zie MCM2-CLAUDE.md §6.
 */
export default function LeverancierDetailPagina() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const vendorId = params.id;

  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [laden, setLaden] = useState(true);
  const [nietGevonden, setNietGevonden] = useState(false);
  const [ophaalFout, setOphaalFout] = useState<string | null>(null);

  const contractenRef = useRef<HTMLDivElement>(null);

  const laad = useCallback(async () => {
    setLaden(true);
    setOphaalFout(null);

    try {
      const gevonden = await haalVendorDetail(vendorId);

      if (!gevonden) {
        setNietGevonden(true);
        return;
      }

      setVendor(gevonden);
    } catch {
      setOphaalFout(
        'De leverancier kon niet worden opgehaald. Controleer of u nog ingelogd bent.',
      );
    } finally {
      setLaden(false);
    }
  }, [vendorId]);

  useEffect(() => {
    void laad();
  }, [laad]);

  /**
   * Doorklik-scenario uit de spec §6: klik op de compliance-badge scrollt
   * naar de Contracten-sectie. Geen navigatie naar een aparte pagina — dat
   * is issue #173, bewust niet nu.
   */
  function scrollNaarContracten() {
    document
      .getElementById(CONTRACTEN_SECTIE_ID)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (nietGevonden) {
    return (
      <AppLayout titel="Leverancier niet gevonden">
        <p className="text-sm text-ink-muted" data-testid="niet-gevonden">
          Deze leverancier bestaat niet, of is verwijderd.
        </p>
        <Link
          href="/beheer/leveranciers"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand-primary hover:underline"
        >
          <ArrowLeft size={14} /> Terug naar de lijst
        </Link>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      titel={vendor?.name ?? 'Leverancier'}
      ondertitel={vendor ? 'Stamgegevens en contactpersonen' : undefined}
    >
      <Link
        href="/beheer/leveranciers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-brand-primary hover:underline"
      >
        <ArrowLeft size={14} /> Terug naar de lijst
      </Link>

      {laden && <p className="text-sm text-ink-muted">Bezig met laden…</p>}

      {ophaalFout && (
        <p
          role="alert"
          data-testid="ophaal-fout"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {ophaalFout}
        </p>
      )}

      {vendor && !laden && (
        <>
          <ClassificatieBadges
            vendor={vendor}
            onOpgeslagen={setVendor}
            onComplianceKlik={scrollNaarContracten}
          />

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div className="flex flex-col gap-3 xl:col-span-1">
              <Stamgegevens
                vendor={vendor}
                onOpgeslagen={setVendor}
                onVerwijderd={() => router.push('/beheer/leveranciers')}
              />
              <Contactpersonen vendor={vendor} onGewijzigd={laad} />
            </div>

            <div className="flex flex-col gap-3 xl:col-span-2">
              <div ref={contractenRef}>
                <Contracten
                  vendorId={vendor.vendorId}
                  contactenVanVendor={vendor.contacten}
                  onContactpersoonAangemaakt={laad}
                  scrollHaakId={CONTRACTEN_SECTIE_ID}
                />
              </div>
              <VendorUitvraagPaneel vendorId={vendor.vendorId} />
            </div>
          </div>
        </>
      )}
    </AppLayout>
  );
}
```

- [ ] **Step 2: Verwijder de nu ongebruikte hulpfuncties**

De hulpfuncties `verwerk`, `hoortBij`, `veldFoutVoor` (oude regel
1857-1913) zijn verplaatst/vervangen — `ContactpersoonModal` en
`Contracten.tsx` gebruiken hun eigen, kleinere foutafhandeling inline (zie
Task 3 en 6). Controleer met een projectbrede zoekopdracht dat er geen
resterende import naar deze functies uit de oude `page.tsx` meer bestaat:

```bash
grep -rn "from '@/app/beheer/leveranciers/\[id\]/page'" src/ e2e/ 2>/dev/null
```

Expected: geen output (niets importeert rechtstreeks uit dit pagina-bestand
buiten Next.js' eigen routing).

- [ ] **Step 3: Commit**

```bash
git add src/app/beheer/leveranciers/[id]/page.tsx
git commit -m "refactor(vendor): leveranciersdetail — badge-strip, twee kolommen, scroll-naar-contract"
```

---

### Task 8: Bestaande e2e-tests aanpassen aan modal en uitklap

**Files:**
- Modify: `e2e/vendor-detail.spec.ts`
- Modify: `e2e/contracten.spec.ts`

De bestaande suites verwachten een altijd-zichtbaar contactformulier
(selectors als `#contactNaam`) en een edit-knop die direct een formulier
toont. Beide interactiepatronen zijn veranderd. Dit is een aanpassing van
bestaande tests, geen herontwerp van de teststrategie.

- [ ] **Step 1: Zoek alle plekken die het oude contactformulier-pad gebruiken**

```bash
grep -n "#contactNaam\|#contactEmail\|voeg-contact-toe\|bewerk-contact\b" e2e/vendor-detail.spec.ts
```

Voor elke match: vervang de directe `#contactNaam`-invulling door eerst een
klik op `open-contact-modal` (nieuwe testid uit Task 4), dan invullen via
`#modal-contactNaam` (nieuwe testid uit Task 3), dan
`contact-modal-opslaan` in plaats van `voeg-contact-toe`. Voorbeeldpatroon:

```ts
// Was:
// await page.locator('#contactNaam').fill(naam);
// await page.getByTestId('voeg-contact-toe').click();

// Wordt:
await page.getByTestId('open-contact-modal').click();
await page.locator('#modal-contactNaam').fill(naam);
await page.getByTestId('contact-modal-opslaan').click();
```

Pas dit toe op elke bestaande test in `vendor-detail.spec.ts` die een
contactpersoon aanmaakt of bewerkt (zoek exact met bovenstaand grep-commando
en werk elke match handmatig na — het aantal matches bepaalt hoeveel tests
dit raakt, niet aan te nemen zonder het commando gedraaid te hebben).

- [ ] **Step 2: Zoek alle plekken die de oude contract-edit-knop gebruiken**

```bash
grep -n "bewerk-contract\b" e2e/contracten.spec.ts
```

Voor elke match: een klik op `bewerk-contract` verwacht nu eerst dat de rij
al uitgeklapt is (klik op `contract-rij` opent de detailweergave, dan pas
toont `bewerk-contract` de bewerkstand):

```ts
// Was:
// await page.getByTestId('bewerk-contract').click();

// Wordt:
await page.getByTestId('contract-rij').first().click();
await page.getByTestId('bewerk-contract').click();
```

- [ ] **Step 3: Zoek plekken die `wachtlijst-checkbox` gebruiken**

```bash
grep -n "wachtlijst-checkbox" e2e/contracten.spec.ts
```

De checkbox-testid is vervangen door een knop-testid `wachtlijst-label`
(Task 6) die alleen verschijnt als de template al gekoppeld is (checkbox
aangevinkt). Pas de test aan:

```ts
// Was:
// await page.getByTestId('wachtlijst-checkbox').first().check();

// Wordt:
await page.getByTestId('survey-template-checkbox').first().check();
await page.getByTestId('wachtlijst-label').first().click();
await expect(page.getByTestId('wachtlijst-label').first()).toHaveText(
  /AAN/,
);
```

- [ ] **Step 4: Draai de volledige e2e-suite lokaal tegen de demo-stack**

Run (volg `docs/runbooks/commandos-en-omgeving.md` voor de exacte
demo-opzet in de backend-repo `MCM2`, dan in `MCM2-frontend`):

```powershell
npx playwright test e2e/vendor-detail.spec.ts e2e/contracten.spec.ts
```

Expected: alle tests PASS. Blijft een test rood, lees eerst de foutmelding
van Playwright (welke selector niet gevonden werd) voordat je verder werkt —
niet aannemen welke test faalt.

- [ ] **Step 5: Commit**

```bash
git add e2e/vendor-detail.spec.ts e2e/contracten.spec.ts
git commit -m "test(contract): e2e-suites aangepast aan modal en uitklapbare contractrij"
```

---

### Task 9: Preview en handmatige controle

**Files:** geen bestandswijziging — verificatiestap.

- [ ] **Step 1: Volg de vaste preview-procedure**

Zoals vastgelegd in het projectgeheugen
(`mcm2-demo-link-incognito-hard-reload`): start de demo-stack met deze
branch, open de link in **incognito**, met **Ctrl+Shift+R** vooraf.

- [ ] **Step 2: Loop de spec-punten handmatig na**

Op het draaiende scherm, controleer:
- Badge-strip toont naam + compliance/kritiek/categorie, klik op elke badge
  opent het juiste bewerkveld.
- Klik op de compliance-badge scrollt naar Contracten.
- "+ toevoegen" bij Contactpersonen opent de modal; opslaan sluit hem en
  toont de nieuwe contactpersoon direct in de lijst.
- Klik op een contactpersoon-"bewerken"-knop opent dezelfde modal,
  vooringevuld.
- Klik op een contractrij klapt de rij uit met alle velden; nogmaals klikken
  klapt hem weer in.
- Een contract met een einddatum binnen 90/30 dagen toont de juiste kleur.
- Een gekoppelde template zonder wachtlijst toont "wachtlijst UIT" plus een
  "nu uitnodigen"-link.

- [ ] **Step 3: Meld het resultaat**

Geen automatische stap — terugkoppelen aan de eigenaar of de preview klopt
met de spec, vóór er gemerged wordt (git-ritueel: pushen → mergen of bewust
parkeren).

---

## Self-review — dekking tegen de spec

- **§3 Layout:** Task 2 (badge-strip), Task 7 (twee kolommen) — gedekt.
- **§4 Modal i.p.v. fold-out:** Task 3, Task 4 — gedekt.
- **§5 Uitklapbare rij + wachtlijst-label + urgentiekleur:** Task 5, Task 6
  — gedekt.
- **§6 Doorklik badge → contract:** Task 7 (`scrollNaarContracten`,
  `onComplianceKlik`-prop in Task 2) — gedekt. Vereenvoudigd t.o.v. de spec:
  scrollt altijd naar de sectie zonder een specifieke rij te forceren
  open te klappen (spec liet dit als toegestane uitkomst toe wanneer niet
  eenduidig af te leiden — hier bewust altijd deze eenvoudigere route,
  geen giswerk over "het" niet-compliante contract).
- **§7 Ongewijzigd:** `VendorUitvraagPaneel` ongewijzigd meegenomen in
  Task 7; backend-routes nergens aangeraakt in dit plan — bevestigd.
- **§8 Test/preview:** Task 8 (e2e), Task 9 (preview) — gedekt.
