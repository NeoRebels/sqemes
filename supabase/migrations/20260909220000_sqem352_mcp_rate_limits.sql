-- SQEM-352 — MCP-Aufrufe begrenzen: pro Schluessel, Lesen und Schreiben getrennt.
--
-- ⛔ WAS HIER BEWUSST *NICHT* STEHT: EINE KALIBRIERTE ZAHL
--
-- Das Ticket verlangt Budgets, die aus den Messungen von SQEM-351 abgeleitet sind. Diese Messungen
-- existieren noch nicht — SQEM-351 ist am selben Tag entstanden und hat keine Minute Produktion
-- gesehen. Eine Zahl zu waehlen und sie „kalibriert" zu nennen waere genau das, wogegen das Ticket
-- geschrieben ist.
--
-- Also zwei getrennte Dinge, und die Unterscheidung ist der Kern dieser Migration:
--
--   **Eine Decke gegen das Absurde** — dafuer braucht man NICHT zu wissen, was normal ist, sondern
--   nur, was unmoeglich sein kann. Zehn Aufrufe pro Sekunde ueber eine Minute ist kein arbeitender
--   Agent, das ist eine Schleife.
--
--   **Ein kalibriertes Budget** — dafuer braucht man die Messung, und die kommt spaeter.
--
-- ⚠️ Heute gibt es auf MCP GAR KEINE Decke. Eine sehr hohe ist strikt besser als keine und kostet
-- niemanden etwas, der arbeitet. Die Werte sind ueber Umgebungsvariablen einstellbar, damit das
-- Nachziehen nach der Messung keine Migration braucht.

-- ⚠️ KEIN Fremdschluessel auf `sqemes_api_keys`, und das ist eine Entscheidung, keine Auslassung.
--
-- `mcp_call_counters` (SQEM-351) traegt einen, weil es dreissig Tage aufbewahrt: verschwindet der
-- Schluessel, soll die Aufzeichnung seiner Nutzung mitverschwinden. Hier sind es zwei Minuten. Eine
-- verwaiste Zeile lebt also laenger nicht als der naechste Kehrlauf, und dafuer nimmt man im heissen
-- Pfad keine Sperr-Abhaengigkeit auf eine Tabelle in Kauf, die bei jedem Verbindungsaufbau
-- geschrieben wird.
--
-- ⭐ Nebeneffekt, der den Selbsttest unten ueberhaupt erst sauber macht: er kann mit einer
-- synthetischen UUID pruefen, ohne einen echten Schluessel zu brauchen oder Constraints
-- wegzunehmen.
create table if not exists public.mcp_rate_counters (
  key_id     uuid    not null,
  window_key bigint  not null,
  kind       text    not null,   -- 'read' | 'write' — nicht die vier Faehigkeiten, siehe unten
  count      integer not null default 0,
  primary key (key_id, window_key, kind)
);

create index if not exists mcp_rate_counters_window_idx on public.mcp_rate_counters (window_key);
alter table public.mcp_rate_counters enable row level security;

comment on table public.mcp_rate_counters is
  'SQEM-352 — per-connection request budget, one-minute buckets, read and write kept apart. '
  '⛔ SEPARATE from mcp_call_counters (SQEM-351) on purpose: that one MEASURES and keeps 30 days at '
  'four capabilities, this one ENFORCES and keeps minutes at two kinds. Merging them would tie a '
  'retention policy to a hot-path check and make one table answer two questions with different '
  'lifetimes — which is how a counter quietly becomes a log. '
  '⚠️ kind is read/write, not the four capabilities: create, update and delete share one budget '
  'because what makes writing expensive is that it changes things, not which verb did it.';

-- ---------------------------------------------------------------------------------------------
-- ⭐ Pro Schluessel, nicht pro Workspace — und der Grund ist, WEN es trifft
--
-- Der aeltere `rate_limit_counters` begrenzt pro Workspace. Das war vor SQEM-346 die einzige
-- Moeglichkeit, weil ein Schluessel workspace-weit sein konnte. Seither gehoert jeder genau einer
-- Person.
--
-- ⛔ Bei einem reinen Workspace-Limit drosselt ein durchgedrehter Client — oder ein abgegriffener
-- Schluessel — DAS GANZE TEAM mit. Der Angreifer richtet dann genau den Schaden an, den die
-- Begrenzung verhindern sollte, nur an den Falschen.
create or replace function public.check_mcp_rate_limit(
  p_key_id uuid, p_kind text, p_limit integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  win       bigint := (extract(epoch from now()) / 60)::bigint;
  new_count integer;
begin
  insert into public.mcp_rate_counters as c (key_id, window_key, kind, count)
  values (p_key_id, win, p_kind, 1)
  on conflict (key_id, window_key, kind)
  do update set count = c.count + 1
  returning c.count into new_count;

  -- Zwei Minuten Historie reichen fuer eine Minutenfenster-Pruefung; hier ist Loeschen bei jedem
  -- Aufruf richtig, weil die Tabelle dadurch winzig bleibt. (Anders als bei SQEM-351, wo dreissig
  -- Tage aufbewahrt werden und deshalb nur gelegentlich gefegt wird.)
  delete from public.mcp_rate_counters
  where window_key < win - 2;

  return new_count <= p_limit;
end;
$$;

comment on function public.check_mcp_rate_limit(uuid, text, integer) is
  'SQEM-352 — increments the per-key, per-kind counter and answers whether the call is within budget. '
  '⚠️ Parameters carry a p_ prefix, and that is not style: naming one after a column is what made the '
  'older rate limiter throw on every call from February to September 2026 (SQEM-335).';

-- ---------------------------------------------------------------------------------------------
-- ⭐ Selbsttest, aus demselben Grund wie in SQEM-335
--
-- Eine Begrenzung, die still nicht begrenzt, sieht von aussen exakt aus wie eine, die greift. Der
-- Test fuehrt die Funktion beim Anwenden AUS und macht den Deploy rot, wenn sie nicht ablehnt —
-- auf jedem Preview-Branch, auf Staging, auf Produktion und auf jeder Self-Host-Instanz.
--
-- ⚠️ Deploy heisst nicht Aufruf. Genau daran ist die alte Begrenzung sieben Monate lang gescheitert.
do $$
declare
  test_key  uuid := gen_random_uuid();
  first_ok  boolean;
  second_ok boolean;
begin
  first_ok  := public.check_mcp_rate_limit(test_key, 'write', 1);
  second_ok := public.check_mcp_rate_limit(test_key, 'write', 1);

  -- Beide Richtungen. Eine Funktion, die immer `true` sagt, ist genau der Zustand, aus dem SQEM-335
  -- kommt — und sie zu pruefen, indem man nur den erlaubten Fall ansieht, haette ihn nicht gefunden.
  if first_ok is not true then
    raise exception 'SQEM-352 self-test: the first call under a limit of 1 was refused';
  end if;
  if second_ok is not false then
    raise exception 'SQEM-352 self-test: the second call over a limit of 1 was allowed — it counts but does not limit';
  end if;

  delete from public.mcp_rate_counters where key_id = test_key;
  raise notice 'SQEM-352 self-test passed: the per-key limiter allows within budget and refuses beyond it';
end $$;
