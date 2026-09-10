/** Point d'entrée : routage, navigation, actions de page. */
import { db } from './store.js';
import { cache, reload } from './data.js';
import { estOuvert } from './models.js';
import { h, $, toast, closeDrawer, confirmDialog } from './ui.js';
import { seedDemo } from './seed.js';

import * as dashboard from './views/dashboard.js';
import * as referentiels from './views/referentiels.js';
import * as parametres from './views/parametres.js';
import { makeModule } from './views/crud.js';
import { config as recCfg } from './views/reclamations.js';
import { config as ncCfg } from './views/nc.js';
import { config as ncrCfg } from './views/ncreception.js';
import { config as actCfg, openNewAction } from './views/actions.js';

const modules = {
  reclamations: makeModule(recCfg),
  nc: makeModule(ncCfg),
  ncreception: makeModule(ncrCfg),
  actions: makeModule(actCfg)
};

const ROUTES = [
  { id: 'dashboard', label: 'Tableau de bord', icon: '📊', group: 'Pilotage',
    sub: 'Vue d’ensemble des indicateurs qualité' },
  { id: 'reclamations', label: 'Réclamations client', icon: '📣', group: 'Traitement',
    sub: 'Réclamations reçues des clients et leur traitement', coll: 'reclamations', domain: 'reclamation' },
  { id: 'nc', label: 'NC internes', icon: '⚠️', group: 'Traitement',
    sub: 'Non-conformités détectées en production', coll: 'nc', domain: 'nc' },
  { id: 'ncreception', label: 'NC réception', icon: '📦', group: 'Traitement',
    sub: 'Non-conformités au contrôle d’entrée fournisseur', coll: 'ncreception', domain: 'ncreception' },
  { id: 'actions', label: 'Plan d’actions', icon: '🎯', group: 'Traitement',
    sub: 'Actions curatives, correctives et préventives', coll: 'actions', domain: 'action' },
  { id: 'referentiels', label: 'Référentiels', icon: '🗂', group: 'Configuration',
    sub: 'Clients, fournisseurs, articles et collaborateurs' },
  { id: 'parametres', label: 'Paramètres', icon: '⚙️', group: 'Configuration',
    sub: 'Base de données, sauvegarde et jeu de démonstration' }
];

let current = 'dashboard';

function go(id) {
  if (location.hash !== '#/' + id) { location.hash = '#/' + id; return; }
  current = id; renderPage();
}

function renderNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  let group = null;
  for (const r of ROUTES) {
    if (r.group !== group) { group = r.group; nav.append(h('div', { class: 'nav-group' }, group)); }
    const open = r.coll ? cache[r.coll].filter(x => estOuvert(r.domain, x.statut)).length : 0;
    nav.append(h('a', {
      href: '#/' + r.id, class: current === r.id ? 'active' : '',
      onclick: () => $('.sidebar').classList.remove('open')
    }, h('span', { class: 'ico' }, r.icon), h('span', {}, r.label),
       open ? h('span', { class: 'count' }, open) : null));
  }
  $('#storage-badge').innerHTML = '';
  $('#storage-badge').append(
    h('b', {}, db.kind === 'supabase' ? '☁️ Supabase' : '💾 Base locale'),
    h('span', {}, db.kind === 'supabase' ? 'Données partagées' : 'Données dans ce navigateur'));
}

function renderPage() {
  const route = ROUTES.find(r => r.id === current) || ROUTES[0];
  $('#page-title').textContent = route.label;
  $('#page-sub').textContent = route.sub || '';

  const actions = $('#page-actions'); actions.innerHTML = '';
  const content = $('#content'); content.innerHTML = '';
  const rerender = () => { content.innerHTML = ''; renderBody(route, content); renderNav(); };

  if (modules[route.id]) {
    const m = modules[route.id];
    actions.append(h('button', {
      class: 'btn primary', onclick: () => m.newItem(rerender)
    }, `＋ Nouvelle ${m.cfg.singular}`));
  }
  if (route.id === 'dashboard') {
    actions.append(h('button', { class: 'btn', onclick: async () => { await reload(); rerender(); toast('Données actualisées'); } }, '↻ Actualiser'));
  }

  renderBody(route, content);
  renderNav();
}

function renderBody(route, content) {
  const rerender = () => { content.innerHTML = ''; renderBody(route, content); renderNav(); };
  if (modules[route.id]) modules[route.id].render(content);
  else if (route.id === 'dashboard') dashboard.render(content, { go });
  else if (route.id === 'referentiels') referentiels.render(content);
  else if (route.id === 'parametres') parametres.render(content, { go });
}

/* --- Événements globaux --- */

window.addEventListener('qf:new-action', e => {
  closeDrawer();
  openNewAction({ ...e.detail, after: () => { renderPage(); } });
});

window.addEventListener('hashchange', () => {
  const id = location.hash.replace(/^#\//, '') || 'dashboard';
  current = ROUTES.some(r => r.id === id) ? id : 'dashboard';
  closeDrawer();
  renderPage();
});

$('#drawer-close').onclick = closeDrawer;
$('#overlay').onclick = closeDrawer;
$('#burger').onclick = () => $('.sidebar').classList.toggle('open');

/* --- Démarrage --- */

async function boot() {
  try {
    await reload();
  } catch (e) {
    $('#content').innerHTML = '';
    $('#content').append(h('div', { class: 'notice' },
      'Impossible d’ouvrir la base de données : ' + e.message +
      ' — vérifiez la configuration dans Paramètres.'));
    return;
  }

  if (await db.isEmpty()) {
    const ok = await confirmDialog(
      'Bienvenue dans QualiFlow. La base est vide : voulez-vous charger un jeu de démonstration ' +
      '(clients, fournisseurs, réclamations, NC et actions) pour découvrir l’application ? ' +
      'Vous pourrez le supprimer à tout moment depuis les Paramètres.',
      { danger: false, okLabel: 'Charger la démo' });
    if (ok) { await seedDemo(); await reload(); }
  }

  const id = location.hash.replace(/^#\//, '') || 'dashboard';
  current = ROUTES.some(r => r.id === id) ? id : 'dashboard';
  renderPage();
}

boot();
