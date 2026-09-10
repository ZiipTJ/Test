-- =====================================================================
-- QualiFlow — schéma PostgreSQL pour Supabase
-- À exécuter dans : Supabase > SQL Editor > New query > Run
-- =====================================================================
--
-- Chaque table suit le même modèle : une clé technique `id` et un
-- document `data` (JSONB) qui porte les champs métier. Ce choix garde le
-- schéma stable quand le modèle de fiche évolue, tout en permettant
-- l'indexation et les requêtes SQL classiques sur les champs JSON.

create extension if not exists "pgcrypto";

do $$
declare t text;
begin
  foreach t in array array[
    'clients','fournisseurs','articles','personnes',
    'reclamations','nc','ncreception','actions','counters','settings'
  ] loop
    execute format($f$
      create table if not exists public.%I (
        id         text primary key,
        data       jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    $f$, t);
  end loop;
end $$;

-- Index utiles pour les filtres et tris les plus fréquents
create index if not exists idx_reclamations_statut on public.reclamations ((data->>'statut'));
create index if not exists idx_reclamations_client on public.reclamations ((data->>'clientId'));
create index if not exists idx_reclamations_date   on public.reclamations ((data->>'dateReception'));
create index if not exists idx_nc_statut           on public.nc ((data->>'statut'));
create index if not exists idx_nc_atelier          on public.nc ((data->>'atelier'));
create index if not exists idx_nc_date             on public.nc ((data->>'dateDetection'));
create index if not exists idx_ncr_statut          on public.ncreception ((data->>'statut'));
create index if not exists idx_ncr_fournisseur     on public.ncreception ((data->>'fournisseurId'));
create index if not exists idx_actions_source      on public.actions ((data->>'sourceType'), (data->>'sourceId'));
create index if not exists idx_actions_pilote      on public.actions ((data->>'pilote'));

-- Mise à jour automatique de updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','fournisseurs','articles','personnes',
    'reclamations','nc','ncreception','actions','counters','settings'
  ] loop
    execute format('drop trigger if exists trg_touch on public.%I;', t);
    execute format('create trigger trg_touch before update on public.%I
                    for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- =====================================================================
-- Sécurité (RLS)
-- ---------------------------------------------------------------------
-- La clé « anon » utilisée par l'application est publique par nature.
-- Deux politiques possibles :
--
--   A. Application interne accessible à tous ceux qui ont l'URL
--      (simple, aucune authentification) — politique ci-dessous.
--   B. Accès réservé aux utilisateurs authentifiés (recommandé dès que
--      les données sont sensibles) — remplacer `anon` par `authenticated`
--      et activer un fournisseur d'authentification Supabase.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'clients','fournisseurs','articles','personnes',
    'reclamations','nc','ncreception','actions','counters','settings'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists acces_app on public.%I;', t);
    -- Variante A : ouverte à la clé anon
    execute format($p$
      create policy acces_app on public.%I
        for all to anon, authenticated
        using (true) with check (true);
    $p$, t);
    -- Variante B (à préférer) : commenter la politique ci-dessus et décommenter
    -- execute format($p$
    --   create policy acces_app on public.%I
    --     for all to authenticated
    --     using (true) with check (true);
    -- $p$, t);
  end loop;
end $$;

-- =====================================================================
-- Vues de reporting (exploitables depuis l'éditeur SQL ou un BI)
-- =====================================================================

create or replace view public.v_reclamations as
select r.id,
       r.data->>'ref'                      as reference,
       (r.data->>'dateReception')::date    as date_reception,
       c.data->>'nom'                      as client,
       r.data->>'typeDefaut'               as type_defaut,
       r.data->>'gravite'                  as gravite,
       r.data->>'statut'                   as statut,
       (r.data->>'echeance')::date         as echeance,
       coalesce((r.data->>'coutMainOeuvre')::numeric,0)
     + coalesce((r.data->>'coutMatiere')::numeric,0)
     + coalesce((r.data->>'coutTransport')::numeric,0)
     + coalesce((r.data->>'coutAvoir')::numeric,0)
     + coalesce((r.data->>'coutAutre')::numeric,0) as cout_non_qualite
from public.reclamations r
left join public.clients c on c.id = r.data->>'clientId';

create or replace view public.v_nc_reception as
select n.id,
       n.data->>'ref'                      as reference,
       (n.data->>'dateReception')::date    as date_reception,
       f.data->>'nom'                      as fournisseur,
       a.data->>'reference'                as article,
       (n.data->>'quantiteRefusee')::numeric as quantite_refusee,
       n.data->>'decision'                 as decision,
       n.data->>'statut'                   as statut
from public.ncreception n
left join public.fournisseurs f on f.id = n.data->>'fournisseurId'
left join public.articles a     on a.id = n.data->>'articleId';
