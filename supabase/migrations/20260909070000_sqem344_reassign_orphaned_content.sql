-- SQEM-344 — die Erbfolge deckte nur Templates.
--
-- `reassign_orphaned_templates()` (SQEM-212 → 246) hatte genau eine UPDATE-Anweisung, auf
-- `public.prompts`. Personas und Dateien kamen darin nicht vor — obwohl alle drei Objekte dieselbe
-- Struktur tragen: `created_by` mit `on delete set null`, und eine Zugriffsfunktion, die den
-- Ersteller zuerst und unbedingt prüft.
--
-- ⛔ WAS DADURCH VERLOREN GING, LAUTLOS
--
-- Verlässt jemand den Workspace, wird sein `created_by` NULL. Eine „Only me"-Persona ist dann
-- eigentümerlos, und `can_access_persona()` liefert für JEDEN false — die Persona existiert weiter
-- in der Tabelle und ist für niemanden mehr sichtbar, auch nicht reparierbar. Dieselbe Falle, die
-- SQEM-240 für Templates beschrieben hat, zwei Objekte weiter.
--
-- Bei Dateien trifft es den Fall, den `can_access_file()` selbst benennt — *"Covers the file that
-- has no template yet."* Genau die Datei, die an keinem Template hängt, verliert mit ihrem Uploader
-- den einzigen Zweig, über den sie erreichbar war.
--
-- ⚠️ Es gibt dabei keinen Fehler und keine Meldung. Wer es angelegt hat, ist zu diesem Zeitpunkt
-- bereits weg; es gibt nicht einmal jemanden, der es vermissen würde.
--
-- ⚠️ UMBENANNT, NICHT NUR ERWEITERT
--
-- Ein Name, der die Hälfte des Umfangs nennt, ist der Grund, aus dem beim Hinzufügen der Personas
-- (SQEM-324, 2026-09-03) niemand hier nachgesehen hat. SQEM-246 hat dieselbe Entscheidung schon
-- einmal getroffen, als sich der Umfang von „privat" auf „alle" weitete
-- (`reassign_private_templates` → `reassign_orphaned_templates`).
--
-- EINE Funktion, nicht drei: getrennte Erbfolgen driften auseinander, sobald ein viertes Objekt
-- dazukommt — und genau so ist dieser Fehler entstanden.

create or replace function public.reassign_orphaned_content(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
begin
  -- Der am längsten dabei seiende Admin, der noch da ist. `workspaces` hat keine Owner-Spalte, also
  -- ist `workspace_members.joined_at` der einzige verfügbare Begriff von „erster Admin" — und den
  -- längsten *aktuellen* zu nehmen beantwortet „was, wenn der erste weg ist" von selbst.
  select wm.user_id into target
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.role = 'admin'
    and wm.user_id <> p_user_id
  order by wm.joined_at asc
  limit 1;

  -- Kein Admin mehr da ⇒ nichts tun. Das Template eines ausgeschiedenen Kollegen einem beliebigen
  -- Mitglied zu geben bräche das Versprechen härter als eine unerreichbare Zeile (SQEM-246).
  if target is null then
    return;
  end if;

  -- Obhut, nicht Autorschaft. Alle drei Objekte, weil alle drei dieselbe Falle haben.
  update public.prompts p
  set created_by = target
  where p.workspace_id = p_workspace_id and p.created_by = p_user_id;

  update public.personas pe
  set created_by = target
  where pe.workspace_id = p_workspace_id and pe.created_by = p_user_id;

  update public.workspace_files f
  set created_by = target
  where f.workspace_id = p_workspace_id and f.created_by = p_user_id;
end;
$$;

comment on function public.reassign_orphaned_content(uuid, uuid) is
  'SQEM-344 (was reassign_orphaned_templates, SQEM-246; davor reassign_private_templates, SQEM-212) '
  '— on departure, hands EVERY template, persona AND file of the leaving member to the '
  'longest-standing remaining admin. All three carry created_by with on delete set null and an '
  'access function that tests the creator first, so an ownerless one is unreachable for everyone '
  'and unrepairable. Custody, not authorship. No admin left => nothing moves.';

-- Beide Trigger-Funktionen auf den neuen Namen ziehen. Die Trigger selbst bleiben unverändert —
-- sie zeigen auf diese Funktionen, nicht auf die umbenannte.
create or replace function public.on_workspace_member_removed()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Deleting a whole workspace cascades its member rows through here. There is nothing to hand over
  -- then — the prompts are going too — so check the workspace still exists before touching it.
  --
  -- ⚠️ Unverändert aus SQEM-246 übernommen. Diese Bedingung sieht wie eine Nullprüfung aus und ist
  -- keine: sie unterscheidet „ein Mitglied geht" von „der Workspace geht". Ersetzt man sie durch
  -- etwas Naheliegenderes, laufen bei jeder Workspace-Löschung Updates auf Zeilen, die im selben
  -- Vorgang verschwinden.
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    perform public.reassign_orphaned_content(old.workspace_id, old.user_id);
  end if;
  return old;
end;
$$;

-- Weiterhin BEFORE dem Löschen: `created_by` ist ein Fremdschlüssel mit `on delete set null`, und
-- die Reihenfolge zweier FK-Aktionen ist nicht definiert. Darauf zu bauen, dass die
-- Mitgliedschaftskaskade zuerst greift, wäre ein Münzwurf.
create or replace function public.on_profile_deleted()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ws record;
begin
  for ws in select workspace_id from public.workspace_members where user_id = old.id loop
    perform public.reassign_orphaned_content(ws.workspace_id, old.id);
  end loop;
  return old;
end;
$$;

-- Erst jetzt, nachdem beide Aufrufer umgestellt sind. Zwei Namen für dieselbe Regel sind genau die
-- Drift, gegen die dieses Ticket antritt.
drop function if exists public.reassign_orphaned_templates(uuid, uuid);
