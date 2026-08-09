import { Test } from '@nestjs/testing';

import { LogMailKanaal } from '../src/mail/log-mail-kanaal';
import { MailKanaal } from '../src/mail/mail-kanaal';
import { MailModule } from '../src/mail/mail.module';

/**
 * Een testrun verstuurt geen echte mail.
 *
 * ── Aanleiding ───────────────────────────────────────────────────────────────
 *
 * Op 2026-08-09 verstuurde `npm run verify:volledig` een echte uitnodigingsmail
 * naar een bestaand postvak. Twee op zichzelf onschuldige dingen kwamen samen:
 *
 *   1. `platform-routes.e2e-spec.ts` gebruikte een bestaand e-mailadres als
 *      testgegeven — het stond er al maanden, en tot die dag deed de route er
 *      niets mee.
 *   2. De e2e-run erft `RESEND_API_KEY` uit `.env` via `jest-e2e.setup.ts`.
 *
 * Sinds de platformroute een uitnodiging verstuurt (2026-08-09) betekende dat
 * samen: post naar een echt adres, bij elke verificatierun.
 *
 * ── Waarom een eigen suite en niet alleen een ander adres ────────────────────
 *
 * Het adres is aangepast, maar dat beschermt alleen tegen de adressen die
 * iemand vandaag heeft opgeschreven. De volgende suite die een uitnodiging
 * verstuurt begint weer bij nul.
 *
 * `jest-e2e.setup.ts` wist daarom `RESEND_API_KEY`, en deze suite bewaakt dát.
 * Zelfde vorm als `jest-e2e.guard.ts` voor de database: niet vertrouwen op wat
 * er in een test staat, maar het onmogelijk maken — en dan bewijzen dat het
 * onmogelijk is.
 *
 * Deze suite draait bewust géén applicatie op en raakt de database niet. Hij
 * toetst één ding: welk mailkanaal de module kiest onder testomstandigheden.
 */

describe('Een testrun verstuurt geen echte mail', () => {
  it('heeft geen mailsleutel in de omgeving', () => {
    // De directe controle op wat jest-e2e.setup.ts doet. Zou iemand die regel
    // weghalen, dan is dit de eerste test die rood wordt — met een melding die
    // naar de oorzaak wijst in plaats van naar een gevolg.
    expect(process.env.RESEND_API_KEY).toBeUndefined();
    expect(process.env.MAIL_AFZENDER_ADRES).toBeUndefined();
  });

  it('kiest het logkanaal, niet Resend', async () => {
    // De controle die er werkelijk toe doet. De vorige test toetst een
    // variabele; deze toetst het gedrag dat eruit volgt — en dat is wat
    // bepaalt of er post de deur uitgaat.
    const moduleRef = await Test.createTestingModule({
      imports: [MailModule],
    }).compile();

    const kanaal = moduleRef.get<MailKanaal>(MailKanaal);

    expect(kanaal).toBeInstanceOf(LogMailKanaal);

    await moduleRef.close();
  });
});
