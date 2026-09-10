/** Paramètres : base de données, sauvegarde/restauration, jeu de démonstration. */
import { db, saveBackendConfig, getBackendConfig, COLLECTIONS } from '../store.js';
import { cache, reload } from '../data.js';
import { seedDemo } from '../seed.js';
import { h, card, buildForm, toast, confirmDialog, downloadBlob, fmtDateTime } from '../ui.js';

export function render(container, { go } = {}) {
  const rerender = () => { container.innerHTML = ''; render(container, { go }); };
  const cfg = getBackendConfig() || { mode: 'local' };

  /* --- Base de données --- */
  const modeSel = h('select', { style: 'max-width:340px' },
    h('option', { value: 'local', selected: cfg.mode !== 'supabase' }, 'IndexedDB — base locale du navigateur'),
    h('option', { value: 'supabase', selected: cfg.mode === 'supabase' }, 'Supabase — base PostgreSQL partagée'));

  const supaForm = buildForm([
    { name: 'url', label: 'URL du projet Supabase', full: true, placeholder: 'https://xxxxxxxx.supabase.co' },
    { name: 'key', label: 'Clé publique (anon key)', full: true, placeholder: 'eyJhbGciOi…' }
  ], { url: cfg.url || '', key: cfg.key || '' });

  const supaBox = h('div', { hidden: cfg.mode !== 'supabase' },
    h('div', { class: 'notice info' },
      'Créez un projet gratuit sur supabase.com, exécutez le script ',
      h('code', {}, 'sql/schema.sql'),
      ' fourni dans le dépôt, puis collez ci-dessous l’URL et la clé ', h('b', {}, 'anon'),
      '. La clé anon est prévue pour être publique : protégez vos données avec les politiques RLS du script.'),
    supaForm);

  modeSel.onchange = () => { supaBox.hidden = modeSel.value !== 'supabase'; };

  const applyBackend = async () => {
    if (modeSel.value === 'local') {
      saveBackendConfig({ mode: 'local' });
    } else {
      const v = supaForm.readValues();
      if (!v.url || !v.key) { toast('URL et clé sont requises.', 'err'); return; }
      saveBackendConfig({ mode: 'supabase', url: v.url, key: v.key });
    }
    toast('Configuration enregistrée — rechargement…', 'ok');
    setTimeout(() => location.reload(), 700);
  };

  const dbCard = card({ title: 'Base de données', sub: 'Actuellement : ' + db.label },
    h('div', { class: 'field', style: 'max-width:420px;margin-bottom:14px' },
      h('label', {}, 'Moteur de stockage'), modeSel,
      h('span', { class: 'help' }, 'Le mode local ne partage pas les données entre postes ni entre navigateurs.')),
    supaBox,
    h('div', { style: 'margin-top:14px' },
      h('button', { class: 'btn primary', onclick: applyBackend }, '💾 Appliquer et recharger')));

  /* --- Sauvegarde --- */
  const doExport = async () => {
    const dump = await db.exportAll();
    downloadBlob(`qualiflow-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(dump, null, 2));
    toast('Sauvegarde téléchargée', 'ok');
  };

  const fileInput = h('input', { type: 'file', accept: '.json', style: 'display:none' });
  fileInput.onchange = async () => {
    const file = fileInput.files[0]; if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!await confirmDialog('La restauration remplace l’intégralité des données actuelles. Continuer ?')) return;
      await db.importAll(payload);
      await reload();
      toast('Données restaurées', 'ok'); rerender();
    } catch (e) {
      toast('Import impossible : ' + e.message, 'err');
    } finally { fileInput.value = ''; }
  };

  const stats = h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin-bottom:16px' },
    [['reclamations', 'Réclamations'], ['nc', 'NC internes'], ['ncreception', 'NC réception'], ['actions', 'Actions'],
     ['clients', 'Clients'], ['fournisseurs', 'Fournisseurs'], ['articles', 'Articles'], ['personnes', 'Collaborateurs']]
      .map(([c, l]) => h('div', { style: 'background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 12px' },
        h('div', { style: 'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em' }, l),
        h('div', { style: 'font-size:19px;font-weight:700' }, cache[c].length))));

  const backupCard = card({ title: 'Sauvegarde et restauration' },
    stats,
    h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
      h('button', { class: 'btn primary', onclick: doExport }, '⬇ Exporter toutes les données (JSON)'),
      h('button', { class: 'btn', onclick: () => fileInput.click() }, '⬆ Restaurer une sauvegarde'),
      fileInput),
    h('p', { style: 'color:var(--muted);font-size:12.5px;margin:12px 0 0' },
      'En mode local, les données vivent dans ce navigateur uniquement. Exportez régulièrement pour ne rien perdre.'));

  /* --- Données --- */
  const loadDemo = async () => {
    if (!await confirmDialog('Charger le jeu de démonstration ? Les données existantes sont conservées et complétées.', { danger: false, okLabel: 'Charger' })) return;
    await seedDemo(); await reload();
    toast('Jeu de démonstration chargé', 'ok'); rerender();
  };

  const wipe = async () => {
    if (!await confirmDialog('Effacer TOUTES les données (fiches et référentiels) ? Cette opération est irréversible.')) return;
    for (const c of COLLECTIONS) await db.clear(c);
    await reload();
    toast('Base vidée', 'ok'); rerender();
  };

  const dataCard = card({ title: 'Jeu de données' },
    h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' },
      h('button', { class: 'btn', onclick: loadDemo }, '🎲 Charger le jeu de démonstration'),
      h('button', { class: 'btn danger', onclick: wipe }, '🗑 Vider la base')));

  const aboutCard = card({ title: 'À propos' },
    h('p', { style: 'margin:0 0 8px;line-height:1.6' },
      'QualiFlow — application de gestion qualité (réclamations client, non-conformités internes, ',
      'non-conformités réception, plan d’actions). Interface statique publiable sur GitHub Pages.'),
    h('p', { style: 'margin:0;color:var(--muted);font-size:12.5px' },
      'Collections : ', COLLECTIONS.join(', ')));

  container.append(h('div', { class: 'grid g2' }, dbCard, backupCard),
    h('div', { class: 'grid g2', style: 'margin-top:16px' }, dataCard, aboutCard));
}
