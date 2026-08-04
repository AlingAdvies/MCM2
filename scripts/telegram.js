// Telegram-meldingen met demping.
//
// Patroon overgenomen uit C:\DEV\prive\Saxo (src/core/telegram-notifier.js en
// scripts/server-health-check.sh), omdat dat zich daar bewezen heeft. De kern
// ervan is niet het versturen maar het DEMPEN: maximaal twee berichten per
// incident, daarna stilte tot het is opgelost.
//
// Reden, letterlijk uit de Saxo-code: "geen constante stroom van meldingen bij
// een aanhoudende structurele fout". Een probleem dat vijf dagen duurt moet niet
// vijf keer melden — dan leer je het bericht negeren, en dan is de melding net
// zo stil als het logbestand dat niemand opende.
//
// ── Telegram is tijdelijk; Slack is de bestemming ──────────────────────────
//
// Besluit eigenaar 2026-08-04: dit gaat uiteindelijk naar Slack. Telegram is
// gekozen omdat de bot uit de Saxo-app er al is en bewezen werkt — geen
// aanmaakstap, meteen een werkend signaal.
//
// Dat maakt de knip in dit bestand belangrijker dan de inhoud ervan:
//
//   verstuur()          ← het ENIGE dat Telegram-specifiek is (één fetch)
//   meldProbleem()      ← demping: kanaal-onafhankelijk
//   meldHerstel()       ← idem
//   levenstekenNodig()  ← idem
//
// Bij de overstap naar Slack wordt verstuur() vervangen door een webhook-POST.
// De demping, de statusbestanden en het levensteken blijven ongewijzigd — dat
// is de logica die er werkelijk toe doet, en die is niet aan Telegram gebonden.
//
// Gevolg voor nu: MCM2-meldingen komen in hetzelfde gesprek als de
// Saxo-meldingen. Bewuste keuze, acceptabel zolang de eigenaar de enige lezer
// is. Zodra iemand anders moet meekijken, is dat het moment voor Slack —
// niet voor een tweede Telegram-bot.
//
// Zie docs/superpowers/specs/2026-08-04-backupcontrole-en-signalering.md §6.

const fs = require('fs');
const path = require('path');

// Na hoeveel uur een aanhoudend probleem een tweede (en laatste) bericht krijgt.
// Saxo gebruikt 6 uur voor een serverbewaking die elk uur draait. Voor een
// dagelijkse backup is 48 uur passender: het tweede bericht zegt dan "dit is nu
// twee dagen mis" in plaats van dat het vanochtend herhaalt.
const ESCALATIE_UREN = Number(process.env.BACKUP_ESCALATIE_UREN || 48);

/**
 * Leest een enkele sleutel uit .env zonder het bestand uit te voeren.
 *
 * Bewust geen dotenv en geen `source`: in .env staat MIGRATION_DATABASE_URL met
 * het productiewachtwoord erin. Een meldingsscript heeft daar niets te zoeken.
 * Saxo lost dit met `sed` op; dit is dezelfde gedachte in Node.
 */
function leesEnvSleutel(sleutel, envPad) {
  try {
    const inhoud = fs.readFileSync(envPad, 'utf8');
    for (const regel of inhoud.split(/\r?\n/)) {
      const match = regel.match(new RegExp(`^\\s*${sleutel}\\s*=\\s*(.*)$`));
      if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Geen .env is geen fout: op een machine zonder bot hoort dit script
    // gewoon door te draaien.
  }
  return '';
}

class Telegram {
  #token;
  #chatId;
  #statusMap;

  constructor({ projectDir, statusDir }) {
    const envPad = path.join(projectDir, '.env');
    this.#token =
      process.env.TELEGRAM_BOT_TOKEN || leesEnvSleutel('TELEGRAM_BOT_TOKEN', envPad);
    this.#chatId =
      process.env.TELEGRAM_CHAT_ID || leesEnvSleutel('TELEGRAM_CHAT_ID', envPad);
    this.#statusMap = statusDir;
    fs.mkdirSync(statusDir, { recursive: true });
  }

  get geconfigureerd() {
    return Boolean(this.#token && this.#chatId);
  }

  /**
   * Verstuurt een bericht. Ontbreekt de configuratie, dan is dit een no-op met
   * een logregel — geen crash. Zo blijft het script bruikbaar in CI en op een
   * machine zonder bot (zelfde keuze als Saxo).
   */
  async verstuur(tekst) {
    if (!this.geconfigureerd) {
      console.log('Telegram niet geconfigureerd — bericht niet verstuurd:');
      console.log(tekst);
      return false;
    }

    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.#token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.#chatId, text: tekst }),
          signal: AbortSignal.timeout(20_000),
        },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`Telegram-bericht mislukt: ${res.status} ${body}`);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`Telegram-bericht mislukt: ${err.message}`);
      return false;
    }
  }

  #statusPad(sleutel) {
    return path.join(this.#statusMap, `probleem_${sleutel}`);
  }

  /**
   * Meldt een probleem, gedempt: bericht 1 bij het eerste optreden, bericht 2
   * pas als het ESCALATIE_UREN aanhoudt, daarna stilte tot herstel.
   */
  async meldProbleem(sleutel, bericht) {
    const pad = this.#statusPad(sleutel);
    const nu = Date.now();

    if (!fs.existsSync(pad)) {
      fs.writeFileSync(pad, `${nu} 0\n`);
      await this.verstuur(`🔴 ${bericht}`);
      return;
    }

    const [eersteStr, geescaleerd] = fs.readFileSync(pad, 'utf8').trim().split(' ');
    if (geescaleerd === '1') return;

    const eerste = Number(eersteStr);
    const verstrekenUren = (nu - eerste) / 3_600_000;
    if (verstrekenUren < ESCALATIE_UREN) return;

    fs.writeFileSync(pad, `${eerste} 1\n`);
    const dagen = Math.floor(verstrekenUren / 24);
    await this.verstuur(
      `🔴 Houdt ${dagen} dag(en) aan — dit is de laatste melding tot het opgelost is:\n\n${bericht}`,
    );
  }

  /**
   * Meldt herstel, maar alleen als er daadwerkelijk een probleem openstond.
   * Zonder dit bericht is stilte dubbelzinnig: je weet niet of het opgelost is
   * of dat de melder stuk is.
   */
  async meldHerstel(sleutel, omschrijving) {
    const pad = this.#statusPad(sleutel);
    if (!fs.existsSync(pad)) return;

    const [eersteStr] = fs.readFileSync(pad, 'utf8').trim().split(' ');
    const minuten = Math.round((Date.now() - Number(eersteStr)) / 60_000);
    const uren = Math.floor(minuten / 60);
    const duur =
      uren >= 24
        ? `${Math.floor(uren / 24)}d ${uren % 24}u`
        : uren > 0
          ? `${uren}u ${minuten % 60}m`
          : `${minuten}m`;

    fs.unlinkSync(pad);
    await this.verstuur(`✅ Hersteld na ${duur}: ${omschrijving}`);
  }

  /**
   * Levensteken: stuurt hooguit één keer per periode `true` terug.
   *
   * Dit is het onderdeel dat stilte betekenisvol maakt. Zonder levensteken weet
   * je bij uitblijvende berichten niet of alles goed gaat of dat de melder zelf
   * stuk is — dezelfde faalvorm als het logbestand dat niemand opende.
   *
   * Wekelijks en niet maandelijks zoals bij Saxo: deze backup is het enige
   * vangnet onder een productiedatabase, en een maand blind is te lang.
   */
  levenstekenNodig(periodeDagen = 7) {
    const pad = path.join(this.#statusMap, 'laatste_levensteken');
    const nu = Date.now();

    if (fs.existsSync(pad)) {
      const laatste = Number(fs.readFileSync(pad, 'utf8').trim());
      if ((nu - laatste) / 86_400_000 < periodeDagen) return false;
    }

    fs.writeFileSync(pad, `${nu}\n`);
    return true;
  }
}

module.exports = { Telegram, ESCALATIE_UREN };
