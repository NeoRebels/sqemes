-- SQEM-351 — MCP-Aufrufe zaehlen. Nur zaehlen.
--
-- ⛔ WARUM GEMESSEN WIRD, BEVOR BEGRENZT WIRD
--
-- Niemand weiss, wie viele Aufrufe eine normale Arbeitsstunde erzeugt. `sqemes_api_keys.last_used_at`
-- ist ein Zeitstempel, keine Rate — er sagt, DASS ein Schluessel benutzt wurde, nie WIE OFT.
--
-- Ein geratenes Limit hat zwei Ausgaenge, und beide sind schlecht: es trifft niemanden (dann ist es
-- Zierde), oder es trifft mitten in eine echte Sitzung. Und ein Agent, der mitten in einer Aufgabe
-- abgewiesen wird, sieht fuer den Nutzer nicht nach einer Regel aus, sondern nach einem kaputten
-- Produkt — so wird er es auch berichten.
--
-- ⚠️ Die Intuition taugt hier besonders wenig: ein Modell listet Templates mehrfach je Turn, holt
-- Dateien parallel und wiederholt nach einem Fehler. Was fuer eine Web-Oberflaeche viel waere, ist
-- hier ein normaler Zug.
--
-- ⛔ UND WARUM GERADE JETZT
--
-- Auf Produktion existieren elf Schluessel, alle personengebunden, alle gehoeren Leuten, die man
-- direkt fragen kann. Zeigt eine Messung etwas Unerwartetes, fragt man nach, statt zu spekulieren.
-- **Diese Eigenschaft verschwindet mit dem ersten Fremden — und eine Grundlinie laesst sich
-- rueckwirkend nicht herstellen.**

create table if not exists public.mcp_call_counters (
  key_id     uuid   not null references public.sqemes_api_keys (id) on delete cascade,
  window_key bigint not null,                -- Minutenfenster, floor(epoch/60) — wie beim Ratenzaehler
  capability text   not null,                -- 'read' | 'create' | 'update' | 'delete'
  count      integer not null default 0,
  primary key (key_id, window_key, capability)
);

-- Fuer das Aufraeumen und fuer „zeig mir die Spitzen eines Tages".
create index if not exists mcp_call_counters_window_idx on public.mcp_call_counters (window_key);

-- Nur die Edge Function (Service Role) fasst das an. RLS an, keine Policies — Vollsperre fuer alle
-- anderen, dieselbe Form wie bei `mcp_refresh_tokens` und `mcp_oauth_clients`.
alter table public.mcp_call_counters enable row level security;

comment on table public.mcp_call_counters is
  'SQEM-351 — how many MCP calls a connection makes per minute, split by capability. Exists to give '
  'SQEM-352 a real number instead of a guess: last_used_at says THAT a key was used, never HOW OFTEN. '
  '⛔ Counts only. Nothing here refuses anything. '
  '⚠️ Deliberately holds no content: no arguments, no template ids, no results, and no IP or user '
  'agent — the same decision the request log made. It answers "how much", never "what about" or '
  '"from where". A call log with content would be a second body of data about people''s work, and '
  'nothing here needs it. Rows cascade with the key: once a connection is gone, so is the record of '
  'how it was used.';

comment on column public.mcp_call_counters.capability is
  'SQEM-351 — the capability the call required, taken from TOOL_CAPABILITY in mcp-server rather than '
  'derived here. SQEM-352 needs read and write budgets kept apart, and re-deriving the mapping in a '
  'second place is exactly the drift that cost SQEM-332 and SQEM-349.';

-- ---------------------------------------------------------------------------------------------
-- Ein Aufruf, ein Inkrement. Und gelegentlich aufraeumen.
create or replace function public.record_mcp_call(
  p_key_id uuid, p_capability text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  win bigint := (extract(epoch from now()) / 60)::bigint;
begin
  insert into public.mcp_call_counters as c (key_id, window_key, capability, count)
  values (p_key_id, win, p_capability, 1)
  on conflict (key_id, window_key, capability)
  do update set count = c.count + 1;

  -- ⚠️ Aufraeumen ab Tag eins, aber NICHT bei jedem Aufruf.
  --
  -- Der Ratenzaehler nebenan loescht bei jedem Aufruf — dort ist die Tabelle winzig (zwei Minuten
  -- Historie). Hier sind es dreissig Tage, also waere dasselbe Muster Arbeit ohne Ertrag.
  --
  -- ⛔ Ein Cron waere die andere Moeglichkeit und ist es nicht wert: es gibt in diesem Projekt keinen
  -- fuer solche Zwecke, und ein Zeitplan, den niemand ueberwacht, ist genau die Art Mechanik, die
  -- SQEM-335 sieben Monate lang still ausgefallen ist. Ein gelegentlicher Lauf im heissen Pfad kann
  -- nicht unbemerkt aufhoeren zu existieren — wenn Aufrufe passieren, passiert er.
  if random() < 0.001 then
    delete from public.mcp_call_counters
    where window_key < (extract(epoch from now()) / 60)::bigint - (30 * 24 * 60);
  end if;
end;
$$;

comment on function public.record_mcp_call(uuid, text) is
  'SQEM-351 — increments one (key, minute, capability) counter. Retention is 30 days, swept from '
  'inside this function roughly once every thousand calls rather than by a cron: a schedule nobody '
  'watches is the shape of mechanism that failed silently for seven months in SQEM-335, whereas a '
  'sweep in the hot path cannot quietly stop existing while calls are still happening.';

-- ---------------------------------------------------------------------------------------------
-- Die Abfrage, fuer die das Ganze da ist.
--
-- ⚠️ Bewusst eine Sicht und kein Dashboard. Bevor die Zahlen bekannt sind, weiss niemand, welche
-- Darstellung die richtige waere — und ein Dashboard, das die falsche Frage huebsch beantwortet, ist
-- schwerer wieder loszuwerden als eine Abfrage.
create or replace view public.mcp_call_peaks as
select
  c.key_id,
  k.name                                         as connection_name,
  k.user_id,
  to_timestamp(c.window_key * 60)::date          as day,
  c.capability,
  max(c.count)                                   as peak_per_minute,
  sum(c.count)                                   as total_that_day
from public.mcp_call_counters c
join public.sqemes_api_keys k on k.id = c.key_id
group by c.key_id, k.name, k.user_id, to_timestamp(c.window_key * 60)::date, c.capability;

comment on view public.mcp_call_peaks is
  'SQEM-351 — per connection, per day, per capability: the busiest single minute and the day total. '
  'The busiest minute is the number SQEM-352 needs, because a limit is refused per minute and a '
  'daily average hides exactly the burst that would hit it.';
