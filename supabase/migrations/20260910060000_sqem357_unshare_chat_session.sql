-- SQEM-357 — ein geteilter Chat eines Ausgeschiedenen war ein totes Artefakt.
--
-- ⛔ ZWEI DINGE TRAFEN ZUSAMMEN, UND ERST BEIDE ZUSAMMEN ERGEBEN „DAUERHAFT"
--
-- 1 · Es gab keinen Admin-Pfad. `chat_sessions_delete` ist `user_id = auth.uid()`, und
--     `chat_sessions_update` wurde in `20260305000001_collaborative_chat.sql` zwar fuer Mitglieder
--     geoeffnet — aber ohne eigenes `with check`. Postgres wendet die `using`-Klausel dann auch auf
--     die NEUE Zeile an: ein Mitglied darf einen geteilten Chat aendern, solange er geteilt BLEIBT
--     (`model`, `is_generating` fuer den kollaborativen Chat), und scheitert genau in dem Moment, in
--     dem `visibility` auf `private` wechselt.
--
--     ⚠️ Die Policy verhinderte damit ausgerechnet die Operation, um die es hier geht — nicht durch
--     eine Entscheidung, sondern als Nebenwirkung einer Erweiterung, die etwas anderes wollte.
--
-- 2 · Ein geteilter Chat laeuft NIE ab. `manage_chat_session_expiry()` setzt `expires_at := null`,
--     sobald geteilt wird. Private Sitzungen verschwinden nach 30 Tagen; geteilte bleiben.
--
-- ⭐ Daraus folgt die FORM der Reparatur: Zurueckstellen startet den 30-Tage-Zaehler von selbst. Ein
-- Admin muss also nichts loeschen — er nimmt die Teilung zurueck, und die vorhandene Mechanik raeumt
-- auf. Reversibel fuer 30 Tage statt sofort weg.
--
-- ⚠️ Wann es entsteht: `chat_sessions.user_id` ist `on delete cascade` auf `profiles`, ein geloeschtes
-- Profil nimmt seine Chats also mit. Das Artefakt entsteht beim VERLASSEN des Workspace — die
-- Mitgliedszeile faellt, das Profil bleibt, der Chat bleibt geteilt.

create or replace function public.unshare_chat_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  s record;
begin
  select id, workspace_id, visibility into s
  from public.chat_sessions
  where id = p_session_id;

  if s.id is null then
    raise exception 'Chat session not found';
  end if;

  -- ⛔ Admin DIESES Workspace, nicht irgendeines. Ohne die Bindung an `s.workspace_id` waere ein
  -- Admin eines beliebigen Workspace berechtigt, in einem fremden zu wirken.
  if public.get_user_role(s.workspace_id) <> 'admin' then
    raise exception 'Only a workspace admin may withdraw a shared chat';
  end if;

  /*
   * ⛔ NUR IN EINE RICHTUNG, UND DAS IST DER KERN DIESER FUNKTION.
   *
   *   geteilt  -> privat   erlaubt
   *   privat   -> geteilt  NIEMALS
   *
   * Zuruecknehmen ist eine VERRINGERUNG, Teilen ist eine OFFENLEGUNG. Ein Admin, der den privaten
   * Chat einer Kollegin sichtbar machen kann, haette eine voellig andere Befugnis als einer, der eine
   * bereits getroffene Teilung zuruecknimmt — und der Unterschied verschwindet, sobald die Funktion
   * beide Richtungen kann.
   *
   * ⚠️ Deshalb nimmt sie KEINEN Zielwert entgegen. Ein Parameter `p_visibility` waere die bequemere
   * Signatur und genau der Weg, auf dem die Gegenrichtung spaeter „nur noch durchgereicht" wird.
   */
  if s.visibility <> 'workspace' then
    raise exception 'This chat is not shared; there is nothing to withdraw';
  end if;

  -- Der Trigger `manage_chat_session_expiry` setzt `expires_at` dabei auf now() + 30 Tage. Hier
  -- NICHT selbst setzen: zwei Stellen, die dieselbe Frist bestimmen, driften auseinander.
  update public.chat_sessions
  set visibility = 'private'
  where id = p_session_id;
end;
$$;

comment on function public.unshare_chat_session(uuid) is
  'SQEM-357 — lets a workspace admin withdraw a shared chat, so a session belonging to someone who '
  'has left the workspace stops being a permanent artefact nobody can manage. ⛔ One direction only: '
  'shared -> private. Withdrawing is a REDUCTION; sharing is a DISCLOSURE, and an admin who could '
  'publish a colleague''s private chat would hold a completely different power. The function takes no '
  'target value on purpose — a p_visibility parameter is the convenient signature and exactly how the '
  'other direction later gets "just passed through". '
  '⚠️ The content stays with its author: after withdrawal chat_sessions_select still matches on '
  'user_id = auth.uid(), so they keep seeing their own conversation. The admin takes back the sharing, '
  'not the chat. Expiry is left to manage_chat_session_expiry() (30 days) rather than set here — two '
  'places deciding one deadline drift apart.';

-- ---------------------------------------------------------------------------------------------
-- ⭐ Selbsttest — dieselbe Begruendung wie in SQEM-335/352
--
-- ⛔ Geprueft wird vor allem die GEGENRICHTUNG. Dass „geteilt -> privat" funktioniert, faellt beim
-- ersten Gebrauch auf; dass „privat -> geteilt" unmoeglich ist, faellt NIE auf — bis es jemand tut.
-- Genau solche Eigenschaften gehoeren an die Stelle, an der das Ausbleiben laut ist.
do $$
declare
  ws_id   uuid;
  usr_id  uuid;
  sess_id uuid;
  refused boolean := false;
begin
  -- Ohne echten Workspace samt Admin laesst sich das nicht ausfuehren; auf einer frischen Datenbank
  -- ist beides leer. Dann wird die reine STRUKTUR geprueft und der Rest uebersprungen — ein Test,
  -- der auf einer leeren Instanz die Installation abbricht, waere schlechter als keiner.
  select w.id into ws_id from public.workspaces w limit 1;
  if ws_id is null then
    raise notice 'SQEM-357 self-test skipped: no workspace on this database yet';
    return;
  end if;

  select wm.user_id into usr_id
  from public.workspace_members wm where wm.workspace_id = ws_id limit 1;
  if usr_id is null then
    raise notice 'SQEM-357 self-test skipped: workspace has no members yet';
    return;
  end if;

  insert into public.chat_sessions (workspace_id, user_id, title, visibility)
  values (ws_id, usr_id, 'SQEM-357 self-test', 'private')
  returning id into sess_id;

  -- Die Funktion muss eine bereits private Sitzung ABLEHNEN. Taete sie es nicht, waere sie ein
  -- Sichtbarkeits-Setzer mit einem irrefuehrenden Namen.
  begin
    perform public.unshare_chat_session(sess_id);
  exception when others then
    refused := true;
  end;

  delete from public.chat_sessions where id = sess_id;

  if not refused then
    raise exception 'SQEM-357 self-test: unshare_chat_session accepted an already-private session — it is not one-directional';
  end if;

  raise notice 'SQEM-357 self-test passed: withdrawing only applies to a shared session';
end $$;
