#!/usr/bin/env node
'use strict';

/**
 * Wat draait er op acceptatie en productie?
 *
 * Leest de werkelijke toestand van de server, niet een bestand dat zegt wat er
 * zou moeten draaien. Dat onderscheid is in dit project twee keer duur geweest:
 * een geruststellende melding over iets dat niet gebeurd was.
 *
 * Raakt niets aan — uitsluitend lezen.
 *
 *   npm run deploy:status
 */

const { spawnSync } = require('node:child_process');

const SERVER = 'root@saxombp';

const OMGEVINGEN = [
  { naam: 'acceptatie', project: 'mcm2-acceptatie', api: 5011, frontend: 3010 },
  { naam: 'productie', project: 'mcm2-productie', api: 5021, frontend: 3020 },
];

const kleur = {
  groen: (t) => `\x1b[32m${t}\x1b[0m`,
  rood: (t) => `\x1b[31m${t}\x1b[0m`,
  grijs: (t) => `\x1b[90m${t}\x1b[0m`,
};

function opServer(commando) {
  const res = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', SERVER, commando],
    { encoding: 'utf8' },
  );

  return {
    ok: res.status === 0,
    uit: (res.stdout || '').trim(),
    fout: (res.stderr || '').trim(),
  };
}

function main() {
  console.log('');
  console.log(`Uitrolstatus — ${SERVER}`);
  console.log('');

  const bereik = opServer('echo ja');

  if (!bereik.ok) {
    console.error(kleur.rood('De server is niet bereikbaar.'));
    console.error(bereik.fout);
    console.error('');
    console.error('Draait Tailscale? Controleer met: tailscale status');
    console.error('');
    process.exitCode = 1;
    return;
  }

  for (const omgeving of OMGEVINGEN) {
    console.log(`── ${omgeving.naam.toUpperCase()} ${'─'.repeat(50 - omgeving.naam.length)}`);

    const containers = opServer(
      `docker ps --filter "label=com.docker.compose.project=${omgeving.project}" ` +
        `--format '{{.Names}}|{{.Image}}|{{.Status}}' 2>/dev/null || true`,
    );

    const regels = containers.uit.split('\n').filter(Boolean);

    if (regels.length === 0) {
      console.log(kleur.grijs('   Er draait niets.'));
      console.log(kleur.grijs(`   Uitrollen: npm run deploy:${omgeving.naam}`));
      console.log('');
      continue;
    }

    for (const regel of regels) {
      const [naam, image, status] = regel.split('|');
      const dienst = naam.replace(`${omgeving.project}-`, '').replace(/-1$/, '');
      const tag = image.includes(':') ? image.split(':').pop() : image;
      const gezond = /Up /.test(status);

      console.log(
        `   ${gezond ? kleur.groen('●') : kleur.rood('●')} ${dienst.padEnd(10)} ${tag.padEnd(20)} ${status}`,
      );
    }

    // De containers draaien — maar antwoordt de app ook? Dat is een andere
    // vraag, en het verschil daartussen is precies waar een uitrol stilletjes
    // in misgaat.
    const health = opServer(
      `curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:${omgeving.api}/health || echo geen`,
    );
    const web = opServer(
      `curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:${omgeving.frontend}/ || echo geen`,
    );

    console.log('');
    console.log(
      `   backend  http://saxombp:${omgeving.api}/health   ${health.uit === '200' ? kleur.groen('200') : kleur.rood(health.uit)}`,
    );
    console.log(
      `   frontend http://saxombp:${omgeving.frontend}/         ${web.uit === '200' ? kleur.groen('200') : kleur.rood(web.uit)}`,
    );
    console.log('');
  }

  // De Saxo-app draait op dezelfde machine. Zichtbaar houden dat hij ongemoeid
  // is, is onderdeel van "deze omgevingen raken niets anders".
  const saxo = opServer(
    `ss -tln 2>/dev/null | grep -cE ':(8080|8081)\\b' || echo 0`,
  );

  console.log('── ANDERS OP DEZE SERVER ' + '─'.repeat(30));
  console.log(
    saxo.uit === '2'
      ? `   ${kleur.groen('●')} Saxo-app actief op 8080 en 8081`
      : `   ${kleur.rood('●')} Saxo-app: ${saxo.uit} van 2 poorten actief`,
  );
  console.log('');
}

main();
