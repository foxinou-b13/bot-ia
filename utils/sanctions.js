/**
 * utils/sanctions.js — applique une sanction et prévient la personne.
 * Un seul endroit à corriger si Discord change une règle.
 */
const { journaliser } = require('./journal');

const MESSAGE_MP = {
  ban: (serveur, raison) => `Tu as été **banni** de **${serveur}**.\nRaison : ${raison}`,
  kick: (serveur, raison) => `Tu as été **expulsé** de **${serveur}**.\nRaison : ${raison}`,
  mute: (serveur, raison, duree) => `Tu es **en sourdine** sur **${serveur}** pendant ${duree}.\nRaison : ${raison}`,
  warn: (serveur, raison) => `Tu as reçu un **avertissement** sur **${serveur}**.\nRaison : ${raison}`,
};

/** Essaie d'envoyer un message privé ; l'échec n'est jamais bloquant. */
async function prevenir(membre, type, serveur, raison, duree) {
  try {
    const texte = MESSAGE_MP[type]?.(serveur, raison, duree);
    if (!texte) return false;
    await membre.send({ content: texte });
    return true;
  } catch {
    return false;                       // MP fermés : on continue quand même
  }
}

/** Trace l'action dans le salon de logs du serveur. */
async function tracer(guild, entree) {
  return journaliser(guild, entree);
}

/**
 * Bannit un membre.
 * @returns {Promise<{ok:boolean, erreur?:string, mp?:boolean}>}
 */
async function bannir(membre, { raison, auteur, joursMessages = 0, duree = null }) {
  const guild = membre.guild;
  const serveur = guild?.name || 'le serveur';
  const mp = await prevenir(membre, 'ban', serveur, raison);
  try {
    await membre.ban({ reason: `${auteur} : ${raison}`, deleteMessageSeconds: Math.min(joursMessages, 7) * 86400 });
  } catch (erreur) {
    return { ok: false, erreur: erreur.message, mp };
  }
  await tracer(guild, {
    type: 'ban', titre: '🔨 Bannissement', auteur, cible: `${membre.user.tag} (${membre.id})`,
    raison, duree,
  });
  return { ok: true, mp };
}

async function expulser(membre, { raison, auteur }) {
  const guild = membre.guild;
  const serveur = guild?.name || 'le serveur';
  const mp = await prevenir(membre, 'kick', serveur, raison);
  try {
    await membre.kick(`${auteur} : ${raison}`);
  } catch (erreur) {
    return { ok: false, erreur: erreur.message, mp };
  }
  await tracer(guild, {
    type: 'kick', titre: '👢 Expulsion', auteur, cible: `${membre.user.tag} (${membre.id})`, raison,
  });
  return { ok: true, mp };
}

/**
 * Exclut temporairement (timeout natif Discord, pas de rôle à créer).
 */
async function rendreMuet(membre, { raison, auteur, ms, dureeLisible }) {
  const guild = membre.guild;
  const serveur = guild?.name || 'le serveur';
  const duree = dureeLisible || `${Math.round(ms / 60000)} min`;
  const mp = await prevenir(membre, 'mute', serveur, raison, duree);
  try {
    await membre.timeout(ms, `${auteur} : ${raison}`);
  } catch (erreur) {
    return { ok: false, erreur: erreur.message, mp };
  }
  await tracer(guild, {
    type: 'mute', titre: '🔇 Exclusion temporaire', auteur, cible: `${membre.user.tag} (${membre.id})`,
    raison, duree,
  });
  return { ok: true, mp };
}

/** Retire l'exclusion temporaire. */
async function rendreLaParole(membre, { auteur }) {
  try {
    await membre.timeout(null, `${auteur} : fin de l'exclusion`);
  } catch (erreur) {
    return { ok: false, erreur: erreur.message };
  }
  await tracer(membre.guild, {
    type: 'ok', titre: '🔊 Exclusion levée', auteur, cible: `${membre.user.tag} (${membre.id})`,
  });
  return { ok: true };
}

/** Avertissement : enregistré + tracé + MP. */
async function avertir(membre, { raison, auteur, nombre }) {
  const guild = membre.guild;
  const serveur = guild?.name || 'le serveur';
  const mp = await prevenir(membre, 'warn', serveur, raison);
  await tracer(guild, {
    type: 'warn', titre: '⚠️ Avertissement', auteur, cible: `${membre.user.tag} (${membre.id})`,
    raison, duree: nombre ? `Total : ${nombre}` : null,
  });
  return { ok: true, mp };
}

module.exports = { bannir, expulser, rendreMuet, rendreLaParole, avertir, prevenir };
