-- SQEM-348 (Teil 2) — die Verbindungsliste soll sagen, WELCHER Client sie ist.
--
-- ⛔ DIE URSACHE WAR EINE ANDERE ALS IM TICKET ANGENOMMEN
--
-- Das Nutzer-Feedback beschrieb, dass sich pro Person mehrere Schluessel ansammeln und man sie nicht
-- auseinanderhalten kann. Ich hatte das der weggeworfenen `client_id` zugeschrieben. Beim Nachsehen:
-- die eigentliche Ursache ist eine **fest eingebaute Vorgabe** — der Zustimmungsbildschirm schlaegt
-- jedem Client den Namen `Claude Desktop` vor, und fast niemand tippt ihn um. Vier Verbindungen,
-- vier Mal derselbe Name.
--
-- ⚠️ Ebenfalls widerlegt: der Zustimmungsbildschirm fragt WEDER nach Scopes NOCH nach einer
-- Laufzeit. OAuth-Verbindungen entstehen seit SQEM-068 grundsaetzlich nur-lesend und ohne Ablauf;
-- beides wird spaeter in den Einstellungen gepflegt. Es gibt dort also keine Reibung zu entfernen.
--
-- RFC 7591 loest das schon: eine Registrierung traegt `client_name`. Wir haben ihn nur nie gelesen.

-- ── Die Registrierung wird gespeichert, statt vergessen zu werden ─────────────────────────────
--
-- Bisher gab `/register` eine zufaellige `client_id` heraus und schrieb nichts weg. Damit war die
-- Antwort formal korrekt und praktisch wertlos: der Name, den der Client von sich selbst nennt, ging
-- im selben Atemzug verloren.
--
-- ⚠️ Bewusst KEIN Vertrauensanker. Diese Zeile beweist nichts ueber den Client — `client_name` ist
-- selbst gewaehlt und ungeprueft, wie bei jeder dynamischen Registrierung. Sie dient der
-- Wiedererkennung in einer Liste, nicht der Autorisierung. Wer sie je fuer eine Zugriffsentscheidung
-- heranzieht, benutzt sie falsch.
create table if not exists public.mcp_oauth_clients (
  client_id     text primary key,
  client_name   text,
  redirect_uris text[],
  created_at    timestamptz not null default now()
);

-- Nur die Edge Function (Service Role) fasst das an. RLS an, keine Policies — das ist die
-- Vollsperre fuer alle anderen, dieselbe Form wie bei `mcp_refresh_tokens`.
alter table public.mcp_oauth_clients enable row level security;

comment on table public.mcp_oauth_clients is
  'SQEM-348 — RFC 7591 dynamic client registrations, kept so a connection can be shown by the name '
  'the client gave for itself instead of a hardcoded "Claude Desktop" for everyone. ⚠️ NOT a trust '
  'anchor: client_name is self-asserted and unverified, as it is in any dynamic registration. It is '
  'for recognition in a list, never for an access decision.';

-- ── Und der Schluessel merkt sich, aus welcher Registrierung er stammt ────────────────────────
--
-- `mcp_auth_codes` traegt `client_id` bereits durch den Flow; sie kam bloss nie auf der Zielzeile an.
--
-- ⚠️ Nullable, und das bleibt so: manuell erzeugte Schluessel haben keine Registrierung, und die vor
-- SQEM-348 entstandenen OAuth-Verbindungen haben keine mehr. **Ein Backfill ist unmoeglich** — die
-- Registrierungen wurden nie gespeichert. Genau der Fall, den SQEM-346 teuer gemacht hat, hier
-- vorher benannt: `null` heisst hier „unbekannt" und traegt KEINE Bedeutung. Wer ihm je eine gibt,
-- vererbt sie stillschweigend an jede Altzeile.
alter table public.sqemes_api_keys
  add column if not exists client_id text;

comment on column public.sqemes_api_keys.client_id is
  'SQEM-348 — the dynamic-registration client this connection came from, or NULL for a manual key '
  'and for OAuth connections made before this column existed. ⚠️ NULL means "unknown" and carries no '
  'other meaning; do not give it one without backfilling, because there is nothing to backfill from.';
