-- =============================================================================
-- Issue #31: zacht verwijderen (deleted_at vullen) is onmogelijk voor de
-- applicatierol.
--
-- Oorzaak: de policies op clm.vendor, clm."user" en clm.vendor_contact hadden
-- `deleted_at IS NULL` in de USING-clausule. Bij een UPDATE toetst PostgreSQL
-- de zichtbaarheid van het resultaat; zodra deleted_at gevuld wordt valt de rij
-- buiten de policy en wordt de update geweigerd met
-- "new row violates row-level security policy".
--
-- Gevolg vóór deze migratie: journey A uit de MVP-scope (beheerder deactiveert
-- een leverancier) werkt niet, en ontwerp §5a van het leverancierstoken kan
-- niet getest worden — dat rekent erop dat een vendor zacht verwijderbaar is.
--
-- Waarom dit de juiste oplossing is: RLS is een tenant-isolatiegrens. Het
-- filteren van zacht verwijderde rijen is een zaak van de query, niet van de
-- beveiligingslaag. Die twee door elkaar halen levert precies dit soort
-- verrassingen op — en verbergt bovendien dat de policy méér doet dan
-- tenant-isolatie.
--
-- CONSEQUENTIE, bewust geaccepteerd: zacht verwijderde rijen zijn hierna
-- zichtbaar voor de applicatierol. Elke query die ze niet wil tonen moet zelf
-- `WHERE deleted_at IS NULL` meenemen. Dat is expliciet werk in plaats van een
-- impliciet vangnet, maar wel eerlijk: het vangnet blokkeerde stilzwijgend
-- functionaliteit die het schema wél voorschrijft.
--
-- De tenant-isolatie zelf verandert niet: tenant_id = clm.current_tenant_id()
-- blijft in zowel USING als WITH CHECK staan (MCM2-CLAUDE.md §7).
-- =============================================================================

DROP POLICY IF EXISTS vendor_isolation ON clm.vendor;--> statement-breakpoint

CREATE POLICY vendor_isolation ON clm.vendor
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

DROP POLICY IF EXISTS user_isolation ON clm."user";--> statement-breakpoint

CREATE POLICY user_isolation ON clm."user"
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());--> statement-breakpoint

DROP POLICY IF EXISTS vendor_contact_isolation ON clm.vendor_contact;--> statement-breakpoint

CREATE POLICY vendor_contact_isolation ON clm.vendor_contact
    USING (tenant_id = clm.current_tenant_id())
    WITH CHECK (tenant_id = clm.current_tenant_id());
