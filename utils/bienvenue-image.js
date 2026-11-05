/**
 * utils/bienvenue-image.js — génère la carte-image de bienvenue.
 *
 * Fondu du fond choisi par l'admin + avatar du nouveau en rond (anneau blanc)
 * + grand mot BIENVENUE / WELCOME + pseudo — rien d'autre sur l'image. Tout est dessiné localement (canvas), aucune API externe payante.
 *
 * En cas de pépin (image injoignable, taille, mémoire) : on renvoie une erreur,
 * et l'événement bascule sur la carte texte — la bienvenue ne rate jamais.
 */
const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

// Police « Anton » (libre, style condensé des cartes de créateurs), livrée dans le dépôt.
const CHEMIN_FONT = path.join(__dirname, '..', 'assets', 'Anton-Regular.ttf');
let fontPrete = false;
function chargerFont() {
  if (fontPrete) return true;
  try {
    if (fs.existsSync(CHEMIN_FONT)) {
      GlobalFonts.registerFromPath(CHEMIN_FONT, 'Anton');
      fontPrete = true;
      return true;
    }
  } catch { /* police absente → on retombe sur sans-serif */ }
  return false;
}

const LARGEUR = 1280;
const HAUTEUR = 720;
const TAILLE_MAX_TELECHARGEMENT = 8 * 1024 * 1024;   // 8 Mo max par image source
const DELAI_TELECHARGEMENT = 10000;                  // 10 s

const LIBELLES = {
  fr: { titre: 'BIENVENUE' },
  en: { titre: 'WELCOME' },
};

/** Le texte de l'image dépend de la langue choisie par l'admin (français par défaut). */
function construireTextes(langue) {
  return LIBELLES[langue] || LIBELLES.fr;
}

/** Une URL de fond n'est acceptée que si c'est http(s) — sinon on garde le fondu maison. */
function validerUrlFond(url) {
  const brut = String(url || '').trim();
  if (!brut) return { ok: true, valeur: null };                      // vide = fond par défaut
  try {
    const u = new URL(brut);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, raison: 'url-invalide' };
    if (u.hostname === 'localhost' || /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)) {
      return { ok: false, raison: 'url-invalide' };                    // pas de réseaux internes
    }
    return { ok: true, valeur: brut.slice(0, 500) };
  } catch {
    return { ok: false, raison: 'url-invalide' };
  }
}

/** Télécharge une image avec limite de taille et de durée. */
async function chargerImage(url, fetchImpl) {
  const f = fetchImpl || fetch;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_TELECHARGEMENT);
  try {
    const reponse = await f(url, { signal: controleur.signal });
    if (!reponse.ok) throw new Error(`image inaccessible (${reponse.status})`);
    const tampon = Buffer.from(await reponse.arrayBuffer());
    if (tampon.length > TAILLE_MAX_TELECHARGEMENT) throw new Error('image trop lourde (max 8 Mo)');
    if (tampon.length < 100) throw new Error('fichier vide ou abîmé');
    return tampon;
  } finally {
    clearTimeout(minuteur);
  }
}

/** Fonds « maison » proposés dans le panneau de config (aucune image externe needed). */
const THEMES = {
  defaut: { nom: 'Dégradé Otaku',      couleurs: ['#1b2340', '#34406e', '#6e5aa8'] },
  sakura: { nom: 'Sakura',             couleurs: ['#2a1626', '#7a3b5e', '#d98fae'] },
  ocean:  { nom: 'Océan',              couleurs: ['#03202f', '#0d5873', '#4fc3d9'] },
  nuit:   { nom: 'Nuit nippone',       couleurs: ['#0b1026', '#1f2b66', '#5a6ab5'] },
  feu:    { nom: 'Braise',             couleurs: ['#2b0f06', '#8a2f12', '#e07a2b'] },
};
const NOMS_THEMES = Object.fromEntries(Object.entries(THEMES).map(([k, t]) => [k, t.nom]));

function dessinerFondParDefaut(ctx, theme = 'defaut') {
  const t = THEMES[theme] || THEMES.defaut;
  const degrade = ctx.createLinearGradient(0, 0, LARGEUR, HAUTEUR);
  degrade.addColorStop(0, t.couleurs[0]);
  degrade.addColorStop(0.55, t.couleurs[1]);
  degrade.addColorStop(1, t.couleurs[2]);
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  // halos doux pour la profondeur
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath(); ctx.arc(LARGEUR * 0.82, HAUTEUR * 0.2, 230, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(LARGEUR * 0.16, HAUTEUR * 0.78, 300, 0, Math.PI * 2); ctx.fill();
}

/** Échelle le texte pour qu'il rentre dans une largeur donnée (comme sur les modèles). */
function ajusterTaille(ctx, texte, tailleMax, largeurMax) {
  let taille = tailleMax;
  ctx.font = `${taille}px Anton, 'DejaVu Sans', sans-serif`;
  while (ctx.measureText(texte).width > largeurMax && taille > 28) {
    taille -= 4;
    ctx.font = `${taille}px Anton, 'DejaVu Sans', sans-serif`;
  }
  return taille;
}

/**
 * Compose l'image finale à partir de tampons déjà chargés.
 * @returns {Promise<Buffer>} PNG
 */
async function composer({ fondBuffer = null, avatarBuffer = null, pseudo, langue = 'fr', theme = null }) {
  chargerFont();
  const canvas = createCanvas(LARGEUR, HAUTEUR);
  const ctx = canvas.getContext('2d');
  const textes = construireTextes(langue);

  // 1. fond (image de l'admin, recadrée en « cover », ou fondu maison)
  let fond = null;
  if (fondBuffer) {
    try { fond = await loadImage(fondBuffer); } catch { fond = null; }
  }
  if (fond && fond.width && fond.height) {
    const ratio = Math.max(LARGEUR / fond.width, HAUTEUR / fond.height);
    const l = fond.width * ratio; const h = fond.height * ratio;
    ctx.drawImage(fond, (LARGEUR - l) / 2, (HAUTEUR - h) / 2, l, h);
  } else {
    dessinerFondParDefaut(ctx, theme || 'defaut');
  }

  // 2. voile léger pour que le texte reste lisible sur n'importe quel fond
  const voile = ctx.createLinearGradient(0, HAUTEUR * 0.35, 0, HAUTEUR);
  voile.addColorStop(0, 'rgba(6,8,16,0)');
  voile.addColorStop(1, 'rgba(6,8,16,0.72)');
  ctx.fillStyle = voile;
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);

  // 3. avatar en rond avec anneau blanc (comme le modèle)
  const cx = LARGEUR / 2; const cy = 268; const r = 152;
  let visage = null;
  if (avatarBuffer) {
    try { visage = await loadImage(avatarBuffer); } catch { visage = null; }
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
  if (visage && visage.width && visage.height) {
    const ratio = Math.max((r * 2) / visage.width, (r * 2) / visage.height);
    const l = visage.width * ratio; const h = visage.height * ratio;
    ctx.drawImage(visage, cx - l / 2, cy - h / 2, l, h);
  } else {
    // pas d'avatar : initiale sur pastille
    ctx.fillStyle = '#5865f2'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#fff';
    ctx.font = `${r}px Anton, 'DejaVu Sans', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(pseudo || '?').slice(0, 1).toUpperCase(), cx, cy + 10);
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
  ctx.lineWidth = 9; ctx.strokeStyle = '#ffffff'; ctx.stroke();

  // 4. textes : grand titre + pseudo (rien d'autre, la carte reste épurée)
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 4;

  const titre = textes.titre;
  ajusterTaille(ctx, titre, 148, LARGEUR * 0.9);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(titre, cx, 602);

  const nom = String(pseudo || 'nouveau membre');
  ajusterTaille(ctx, nom, 60, LARGEUR * 0.78);
  ctx.fillStyle = '#f4f6ff';
  ctx.fillText(nom, cx, 674);

  ctx.shadowBlur = 0;
  return canvas.toBuffer('image/png');
}

/**
 * Fabrique la carte de bienvenue complète (télécharge le fond et l'avatar).
 * @returns {Promise<Buffer>} PNG prêt à envoyer sur Discord
 */
async function generer({ fondUrl = null, avatarUrl = null, pseudo, langue = 'fr', theme = null, fetchImpl } = {}) {
  const taches = [];
  if (fondUrl) taches.push(chargerImage(fondUrl, fetchImpl).catch(() => null)); else taches.push(Promise.resolve(null));
  if (avatarUrl) taches.push(chargerImage(avatarUrl, fetchImpl).catch(() => null)); else taches.push(Promise.resolve(null));
  const [fondBuffer, avatarBuffer] = await Promise.all(taches);
  return composer({ fondBuffer, avatarBuffer, pseudo, langue, theme });
}

module.exports = {
  generer, composer, construireTextes, validerUrlFond, chargerImage,
  THEMES, NOMS_THEMES,
  LARGEUR, HAUTEUR,
};
