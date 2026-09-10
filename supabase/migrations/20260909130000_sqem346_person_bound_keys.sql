-- SQEM-346 — ein MCP-Schluessel gehoert ab hier ausnahmslos einer Person.
--
-- Entscheidung des Eigentuemers, 2026-09-09: *"aus meiner Sicht braucht man keinen Workspace weiten
-- Key, sondern nur Personengebundene."*
--
-- ⛔ WARUM DAS EINE SICHERHEITSREPARATUR IST UND NICHT NUR EINE GESTRICHENE OPTION
--
-- `sqemes_api_keys.user_id` war nie „kein Wert". Es war ein **Bedeutungstraeger**: `null` IST die
-- Definition des workspace-weiten Schluessels, und `mcp-server` liest genau diese Spalte
-- (`mayWrite = !mcpUserId || …` vor SQEM-346).
--
-- Die Spalte trug aber `on delete set null`. Wurde also ein Profil geloescht, **wechselte der
-- persoenliche Schluessel eines Members die Kategorie** — von „benutzergebunden, seit SQEM-341 nur
-- lesend" zu „workspace-weit, schreibberechtigt ohne Rollenpruefung". Eine Rechteausweitung,
-- ausgeloest durch eine Aufraeumhandlung. Wer ein Konto loescht, erwartet weniger Zugriff, nicht
-- mehr.
--
-- ⚠️ `on delete set null` sieht an jeder anderen Stelle im Schema harmlos aus. Es ist genau dann
-- gefaehrlich, wenn `null` selbst etwas bedeutet — und das steht der Spaltendefinition nicht an.
--
-- Mit `not null` ist der Zustand **nicht mehr darstellbar**. Die Luecke verschwindet konstruktiv
-- statt durch eine Pruefung, die jemand spaeter vergessen kann.
--
-- ⛔ UND DER ZWEITE FALL: NICHTS HAT JE EINEN SCHLUESSEL AUFGERAEUMT
--
-- Kein Trigger, kein Cron, keine Kaskade. Wurde jemand aus dem Workspace entfernt, blieb sein
-- Schluessel gueltig. Die Rollenpruefung aus SQEM-341 machte ihn zwar lesend — aber
-- `mcp_accessible_template_ids()` liefert einem Benutzer ohne Rolle weiterhin **jedes Template ohne
-- Zugriffsregeln**. In einem Workspace ohne konfigurierte Einschraenkungen, dem Normalfall und auf
-- Self-Host praktisch immer, ist das die gesamte Bibliothek.
--
-- ⚠️ Und es meldet niemand: der Client des Ausgeschiedenen laeuft einfach weiter, und die
-- Verbliebenen sehen in der Integrations-Liste keinen Hinweis darauf, dass die Person weg ist.

-- ---------------------------------------------------------------------------------------------
-- 1 · Bestehende workspace-weite Schluessel entfernen.
--
-- ⛔ NICHT UMKEHRBAR, und der Grund, aus dem vor der Produktions-Promotion gezaehlt werden muss:
-- jede Automation, die auf so einem Schluessel laeuft, bricht in dem Moment, in dem das hier
-- durchlaeuft. Die Anzahl geht in den Deploy-Log, damit sie im Nachhinein wenigstens belegt ist.
do $$
declare
  n integer;
begin
  select count(*) into n from public.sqemes_api_keys where user_id is null;
  if n > 0 then
    raise notice 'SQEM-346: removing % workspace-wide MCP key(s) (user_id is null)', n;
    delete from public.sqemes_api_keys where user_id is null;
  else
    raise notice 'SQEM-346: no workspace-wide MCP keys present';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2 · Der Fremdschluessel muss ZUERST auf `cascade` — sonst kollidiert Schritt 3 mit ihm.
--
-- Mit `not null` auf der Spalte und `on delete set null` auf dem FK waere das Loeschen eines Profils
-- ein Fehler statt einer Kaskade: Postgres versuchte `null` zu schreiben und liefe gegen die eigene
-- Bedingung. Die Reihenfolge hier ist also nicht Geschmack, sie ist zwingend.
--
-- Der Constraint-Name ist der von Postgres vergebene (die Spalte kam in SQEM-142 als
-- `add column … references …`). Dynamisch aufgeloest, statt ihn zu raten.
do $$
declare
  fk_name text;
begin
  select con.conname into fk_name
  from pg_constraint con
  join pg_attribute att
    on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
  where con.conrelid = 'public.sqemes_api_keys'::regclass
    and con.contype  = 'f'
    and att.attname  = 'user_id'
  limit 1;

  if fk_name is not null then
    execute format('alter table public.sqemes_api_keys drop constraint %I', fk_name);
  end if;
end $$;

alter table public.sqemes_api_keys
  add constraint sqemes_api_keys_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- ---------------------------------------------------------------------------------------------
-- 3 · Der eigentliche Punkt: der workspace-weite Schluessel wird undarstellbar.
alter table public.sqemes_api_keys
  alter column user_id set not null;

comment on column public.sqemes_api_keys.user_id is
  'SQEM-346 — the person this connection belongs to. NOT NULL: a workspace-wide key (user_id null) '
  'no longer exists, by owner decision 2026-09-09. Before that, null was not an absent value but the '
  'DEFINITION of a workspace-wide key, and the column carried `on delete set null` — so deleting a '
  'profile silently promoted that person''s read-only member key into a write-capable workspace-wide '
  'one. The FK is `on delete cascade` now; both halves are required, and changing either one back '
  'reopens the escalation.';

-- ---------------------------------------------------------------------------------------------
-- 4 · Ausscheiden nimmt die Schluessel mit.
--
-- Dieselbe Funktion, die SQEM-344 gerade auf drei Objekte erweitert hat. Bewusst dieselbe und keine
-- zweite: zwei Aufraeumpfade auf denselben Tabellen driften auseinander, sobald einer erweitert wird
-- — genau der Fehler, den SQEM-344 gekostet hat.
create or replace function public.on_workspace_member_removed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Deleting a whole workspace cascades its member rows through here. There is nothing to hand over
  -- then — the prompts are going too — so check the workspace still exists before touching it.
  --
  -- ⚠️ Unveraendert aus SQEM-246. Diese Bedingung sieht wie eine Nullpruefung aus und ist keine: sie
  -- unterscheidet „ein Mitglied geht" von „der Workspace geht". Ersetzt man sie durch etwas
  -- Naheliegenderes, laufen bei jeder Workspace-Loeschung Updates auf Zeilen, die im selben Vorgang
  -- verschwinden.
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    perform public.reassign_orphaned_content(old.workspace_id, old.user_id);

    -- SQEM-346 — und die MCP-Verbindungen dieser Person in diesem Workspace fallen weg.
    --
    -- Loeschen statt „widerrufen": die Zeile traegt keine Historie, die jemand vermissen wuerde, und
    -- ein widerrufener Schluessel, der in der Integrations-Liste stehen bleibt, ist eine Frage, die
    -- sich sonst jemand stellen muss. `mcp_refresh_tokens` haengt mit `on delete cascade` daran, das
    -- Refresh-Token verschwindet also mit.
    --
    -- ⚠️ NACH der Uebergabe, nicht davor. `reassign_orphaned_content` haengt an `created_by`, nicht an
    -- Schluesseln — die Reihenfolge ist hier folgenlos, aber die Uebergabe ist der Teil, der Daten
    -- rettet, und der laeuft zuerst.
    delete from public.sqemes_api_keys
    where workspace_id = old.workspace_id
      and user_id      = old.user_id;
  end if;
  return old;
end;
$$;

comment on table public.sqemes_api_keys is
  'MCP API keys — SHA-256 hashed, shown once, scoped, revocable (SQEM-044/064). '
  'SQEM-346: every key belongs to exactly one person (user_id NOT NULL, FK on delete cascade); the '
  'workspace-wide key is gone, so authority now hangs on a person without exception. Keys are '
  'deleted when their owner leaves the workspace (on_workspace_member_removed) or their profile is '
  'deleted (FK cascade). RLS: admins manage every key in the workspace (sqemes_api_keys_admin_all); '
  'editors AND members (SQEM-328) manage only their own, enforced in WITH CHECK. AI provider keys '
  'are a different table (workspace_api_keys) and stay closed to members. '
  'Idle expiry (90 days without use) is enforced in mcp-server and mcp-oauth, deliberately NOT by a '
  'cron: refusing an unused key is reversible, deleting its row is not.';
