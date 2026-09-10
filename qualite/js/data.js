/** Cache mémoire des collections + helpers de résolution des libellés. */
import { db, COLLECTIONS } from './store.js';

export const cache = Object.fromEntries(COLLECTIONS.map(c => [c, []]));

export async function reload(colls = COLLECTIONS) {
  await Promise.all(colls.map(async c => { cache[c] = await db.list(c); }));
  return cache;
}

export const byId = (coll, id) => cache[coll].find(x => x.id === id);
export const nomClient = id => byId('clients', id)?.nom || '—';
export const nomFournisseur = id => byId('fournisseurs', id)?.nom || '—';
export const nomArticle = id => { const a = byId('articles', id); return a ? `${a.reference} — ${a.designation}` : '—'; };
export const nomPersonne = id => { const p = byId('personnes', id); return p ? p.nom : '—'; };

export const optClients = () => [...cache.clients].sort(cmpNom).map(c => ({ v: c.id, l: c.nom }));
export const optFournisseurs = () => [...cache.fournisseurs].sort(cmpNom).map(c => ({ v: c.id, l: c.nom }));
export const optArticles = () => [...cache.articles]
  .sort((a, b) => a.reference.localeCompare(b.reference))
  .map(a => ({ v: a.id, l: `${a.reference} — ${a.designation}` }));
export const optPersonnes = () => [...cache.personnes].sort(cmpNom).map(p => ({ v: p.id, l: `${p.nom}${p.service ? ' (' + p.service + ')' : ''}` }));

function cmpNom(a, b) { return (a.nom || '').localeCompare(b.nom || ''); }

/** Actions correctives rattachées à une fiche. */
export const actionsDe = (sourceType, sourceId) =>
  cache.actions.filter(a => a.sourceType === sourceType && a.sourceId === sourceId);
