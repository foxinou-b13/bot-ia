/**
 * utils/garde-ip.js — petite limite anti-inondation, en mémoire.
 * « max » actions par fenêtre glissante de « fenetreMs », par clé (IP, utilisateur…).
 * Sert surtout à protéger les endpoints HTTP de diagnostic (quota IA = argent).
 */
function creerLimite({ max = 5, fenetreMs = 60 * 1000 } = {}) {
  const journal = new Map();   // clé → [horodatages…]

  function Etat(cle) {
    const maintenant = Date.now();
    const recents = (journal.get(cle) || []).filter((t) => maintenant - t < fenetreMs);
    if (recents.length >= max) {
      journal.set(cle, recents);
      const attenteMs = fenetreMs - (maintenant - recents[0]);
      return { bloque: true, resteSecondes: Math.ceil(attenteMs / 1000) };
    }
    recents.push(maintenant);
    journal.set(cle, recents);
    return { bloque: false, restantes: max - recents.length };
  }

  // ménage périodique pour que la mémoire ne gonfle jamais
  const menage = setInterval(() => {
    const maintenant = Date.now();
    for (const [cle, temps] of journal) {
      const vivants = temps.filter((t) => maintenant - t < fenetreMs);
      if (vivants.length) journal.set(cle, vivants); else journal.delete(cle);
    }
  }, fenetreMs);
  if (menage.unref) menage.unref();

  return { Etat, journal };
}

/** L'adresse réelle de l'appelant (Render passe par un proxy → en-tête forwarding). */
function adresseIp(requete) {
  const xff = requete.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return requete.socket?.remoteAddress || 'inconnue';
}

module.exports = { creerLimite, adresseIp };
