// scripts/uitnodiging-nieuwe-leden.js
// Pure functie, los van database en Telegram — zodat de kernlogica
// (wat is "nieuw"?) zonder netwerk of state getest kan worden.
//
// @param {Set<string>} vorigeUserIds - user_id's die de vorige run al zag.
// @param {{userId: string, naam: string, email: string, rol: string}[]} huidigeLeden
// @returns {{userId: string, naam: string, email: string, rol: string}[]}
function bepaalNieuweLeden(vorigeUserIds, huidigeLeden) {
  return huidigeLeden.filter((lid) => !vorigeUserIds.has(lid.userId));
}

module.exports = { bepaalNieuweLeden };
