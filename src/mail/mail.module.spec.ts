import { Test } from '@nestjs/testing';

import { LogMailKanaal } from './log-mail-kanaal';
import { MailKanaal } from './mail-kanaal';
import { MailModule } from './mail.module';

/**
 * De knip uit ontwerp §5 bestaat pas echt als een aanroeper `MailKanaal` kan
 * vragen zonder te weten welke implementatie hij krijgt.
 *
 * Zonder deze test is de abstractie decoratie: hij staat in het bestand, maar
 * niets dwingt af dat de rest van de applicatie hem ook gebruikt.
 */
describe('MailModule', () => {
  it('levert een MailKanaal aan wie erom vraagt', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MailModule],
    }).compile();

    const kanaal = moduleRef.get(MailKanaal);

    expect(kanaal).toBeInstanceOf(MailKanaal);
  });

  it('levert nu LogMailKanaal — er wordt aantoonbaar niets verstuurd', async () => {
    // Zolang ResendMailKanaal niet bestaat (stap 3 uit ontwerp §9) is dit de
    // veilige toestand. Deze test valt om zodra iemand de keuze wijzigt, en dat
    // is precies de bedoeling: een kanaal dat echt verstuurt hoort een bewuste
    // wijziging te zijn, geen bijvangst.
    const moduleRef = await Test.createTestingModule({
      imports: [MailModule],
    }).compile();

    expect(moduleRef.get(MailKanaal)).toBeInstanceOf(LogMailKanaal);
  });

  it('geeft dezelfde instantie voor MailKanaal en LogMailKanaal', async () => {
    // `useExisting` en niet `useClass`: anders bestaan er twee instanties met
    // elk een eigen verzendlijst, en dan controleert een test de ene lijst
    // terwijl de code in de andere schrijft. Dat is een testfout die er
    // uitziet als een codefout.
    const moduleRef = await Test.createTestingModule({
      imports: [MailModule],
    }).compile();

    expect(moduleRef.get(MailKanaal)).toBe(moduleRef.get(LogMailKanaal));
  });
});
