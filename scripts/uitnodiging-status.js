// scripts/uitnodiging-status.js
// Bewaart welke user_id's het script al eerder als "actief" zag, in een
// klein JSON-bestand op de laptop. Geen inhaalslag, geen historie — alleen
// de laatst geziene stand (spec: "mag missen").
const fs = require('fs');
const path = require('path');

/**
 * @param {string} pad
 * @returns {Set<string>} lege Set als het bestand ontbreekt of kapot is —
 *   dat is bewust geen fout: een kapotte/ontbrekende statusfile betekent
 *   hooguit dat de eerstvolgende run alle huidige leden als "nieuw" ziet.
 */
function leesGezienIds(pad) {
  try {
    const ruw = fs.readFileSync(pad, 'utf8');
    const lijst = JSON.parse(ruw);
    if (!Array.isArray(lijst)) return new Set();
    return new Set(lijst);
  } catch {
    return new Set();
  }
}

/**
 * @param {string} pad
 * @param {Set<string>} ids
 */
function schrijfGezienIds(pad, ids) {
  fs.mkdirSync(path.dirname(pad), { recursive: true });
  fs.writeFileSync(pad, JSON.stringify([...ids], null, 2));
}

module.exports = { leesGezienIds, schrijfGezienIds };
