-- SQEM-335 — die Ratenbegrenzung war seit Februar 2026 auf jedem Aufruf kaputt.
--
-- ⛔ DER FEHLER
--
-- `check_and_increment_rate_limit` (Migration 20260222000001) benannte einen Funktionsparameter
-- `window_key` — genauso wie die Spalte in `rate_limit_counters`. Postgres kann den Namen im Rumpf
-- dann nicht mehr aufloesen und wirft `column reference "window_key" is ambiguous` (42702).
--
-- ⚠️ Zwei Stellen, nicht eine, und die zweite ist die schlimmere:
--
--   INSERT ... VALUES (ws_id, window_key, 1)          -- Parameter oder Spalte?
--   DELETE ... WHERE window_key < (…)                 -- ⛔ dito, in einer LOESCHBEDINGUNG
--
-- Haette Postgres die zweite still zugunsten des Parameters aufgeloest, waere aus dem Aufraeumen ein
-- „loesche alles oder nichts" geworden. Es wirft stattdessen — was hier ein Glueck ist.
--
-- ⛔ WARUM ES SIEBEN MONATE NIEMAND GEMERKT HAT
--
-- `_shared/rateLimit.ts` faellt bei einem RPC-Fehler **offen** aus und gibt `true` zurueck. Das ist
-- richtig — eine Ratenbegrenzung, die bei eigenen Stoerungen Nutzer aussperrt, ist schlimmer als das,
-- wogegen sie schuetzt. Aber die RPC warf IMMER, also gab der Helfer IMMER `true` zurueck:
-- `RATE_LIMIT_RPM` existierte als Tabelle, als Code und als Einstellung — nur nicht als Wirkung.
--
-- ⚠️ Der Fehler ging in `console.error`, der Nutzer bekam seine Antwort, kein Test schlug fehl.
-- Gefunden wurde es am 2026-09-07, weil ein Sicherheitsvorfall den Anlass gab, die Edge-Logs auf
-- 400er durchzusehen. **Ein Fail-open, das niemand bemerkt, ist ein abgeschaltetes Feature mit einer
-- Einstellung davor.**

-- ---------------------------------------------------------------------------------------------
-- 1 · Die alte Funktion muss WEG, nicht ersetzt werden
--
-- ⚠️ `create or replace function` kann Parameternamen nicht aendern — Postgres antwortet mit
-- „cannot change name of input parameter". Der Umweg ueber `drop` ist also nicht Geschmack, sondern
-- die einzige Moeglichkeit. Und weil sich damit die benannten Argumente aendern, muss der Aufrufer in
-- `_shared/rateLimit.ts` im selben Zug mit.
drop function if exists public.check_and_increment_rate_limit(uuid, bigint, integer);

-- ---------------------------------------------------------------------------------------------
-- 2 · Neu, mit dem Praefix, das die Mehrdeutigkeit unmoeglich macht
--
-- ⛔ `p_`-Praefix auf JEDEM Parameter, nicht nur auf dem einen, der wehgetan hat. Ein Parameter, der
-- zufaellig nicht wie eine Spalte heisst, ist kein Schutz — er ist ein Zufall, der beim naechsten
-- `alter table` endet.
create or replace function public.check_and_increment_rate_limit(
  p_ws_id      uuid,
  p_window_key bigint,
  p_rate_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.rate_limit_counters as rlc (workspace_id, window_key, count)
  values (p_ws_id, p_window_key, 1)
  on conflict (workspace_id, window_key)
  do update set count = rlc.count + 1
  returning rlc.count into new_count;

  -- Fenster aelter als zwei Minuten wegraeumen, damit die Tabelle klein bleibt.
  delete from public.rate_limit_counters
  where window_key < (extract(epoch from now()) / 60)::bigint - 2;

  return new_count <= p_rate_limit;
end;
$$;

comment on function public.check_and_increment_rate_limit(uuid, bigint, integer) is
  'SQEM-335 — atomically increments the per-workspace counter and answers whether the request is '
  'within the limit. Parameters carry a p_ prefix because the original version named one of them '
  'window_key, exactly like the column, which made the body ambiguous and threw 42702 on EVERY call '
  'from February to September 2026. The caller failed open, so the limit simply never applied. '
  'Never name a parameter after a column in this function.';

-- ---------------------------------------------------------------------------------------------
-- 3 · ⭐ Der Selbsttest — das eigentliche Ergebnis dieses Tickets
--
-- ⛔ Die Frage des Tickets war nicht „wie benennt man den Parameter um", sondern **was den naechsten
-- stillen Ausfall sichtbar macht.** Hier ist die Antwort: die Migration ruft die Funktion auf und
-- bricht ab, wenn sie nicht tut, was sie soll.
--
-- Warum das mehr wiegt, als es aussieht:
--
--   * Es laeuft auf JEDER Datenbank, auf der die Migration angewandt wird — Preview-Branch bei jedem
--     PR, Staging, Produktion, und jede selbst gehostete Instanz. Ein Deploy, der eine kaputte
--     Funktion mitbringt, wird ROT statt still.
--   * Es prueft die Funktion durch AUSFUEHRUNG, nicht durch Existenz. Genau daran ist die alte
--     gescheitert: sie war deployt, sie war in der Doku, sie hatte eine Einstellung — sie lief nur nie
--     erfolgreich durch.
--
-- ⚠️ `rate_limit_counters.workspace_id` traegt keinen Fremdschluessel, eine synthetische UUID ist also
-- unbedenklich. Sie wird trotzdem am Ende entfernt: ein Testartefakt, das liegen bleibt, ist die Art
-- Zeile, die spaeter jemand fuer echt haelt.
do $$
declare
  test_ws  uuid   := gen_random_uuid();
  test_win bigint := (extract(epoch from now()) / 60)::bigint;
  first_ok boolean;
  second_ok boolean;
begin
  -- Limit 1: der erste Aufruf muss durchgehen, der zweite abgelehnt werden. Beides zu pruefen ist
  -- der Punkt — eine Funktion, die immer `true` sagt, ist genau der Zustand, aus dem wir kommen.
  first_ok  := public.check_and_increment_rate_limit(test_ws, test_win, 1);
  second_ok := public.check_and_increment_rate_limit(test_ws, test_win, 1);

  if first_ok is not true then
    raise exception 'SQEM-335 self-test: the first call under a limit of 1 was refused — the rate limiter is broken';
  end if;

  if second_ok is not false then
    raise exception 'SQEM-335 self-test: the second call over a limit of 1 was allowed — the rate limiter counts but does not limit';
  end if;

  delete from public.rate_limit_counters where workspace_id = test_ws;
  raise notice 'SQEM-335 self-test passed: the rate limiter allows within the limit and refuses beyond it';
end $$;
