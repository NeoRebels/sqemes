-- SQEM-341 (Divergenz 1) + SQEM-343 — Schreiben prueft jetzt auch im Browser die Sichtbarkeit.
--
-- ⛔ BEIDE TICKETS IN EINER MIGRATION, UND DAS IST KEINE BEQUEMLICHKEIT
--
-- SQEM-341 allein baut eine Falltuer. Es schliesst die Luecke, dass `prompts_update` und
-- `prompts_delete` nur die ROLLE pruefen und keine Sichtbarkeit — ein Editor konnte per direktem
-- PostgREST-Aufruf ein „Only me" aendern, das `prompts_select` vor ihm verbirgt. Die Oberflaeche bot
-- das nie an, aber die Oberflaeche ist nicht die Grenze; die Policy ist es.
--
-- Sobald diese Luecke zu ist, kombinieren sich zwei je fuer sich vernuenftige Regeln zu einem toten
-- Objekt:
--
--   Herabgestufter Ersteller  sieht es (Ersteller-Zweig)   darf nicht schreiben (Member)
--   Editor / Admin            sieht es NICHT (SQEM-292)    duerfte schreiben
--
-- ⇒ Ein „Only me" einer herabgestuften Person kann dann NIEMAND mehr bearbeiten. Wir wuerden eine
-- Luecke schliessen und dabei eine Sackgasse bauen. Deshalb liefert SQEM-343 im selben Zug die
-- Werkzeuge, mit denen ein Admin die Obhut beim Herabstufen bewusst regelt.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · Die Divergenz schliessen: Schreiben verlangt Sichtbarkeit, wie Lesen
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ Kein `with check`. Ohne eigene `with check`-Klausel benutzt Postgres bei UPDATE die
-- `using`-Klausel fuer BEIDE Seiten — die Zeile vorher und die Zeile nachher. Genau das ist gewollt:
-- wer ein Template so aendert, dass er es selbst nicht mehr sehen duerfte, soll das nicht koennen.
-- Eine zweite, abweichende Klausel waere eine zweite Definition derselben Regel.

drop policy if exists "prompts_update" on public.prompts;
create policy "prompts_update"
  on public.prompts for update
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
    and public.can_access_template(id, workspace_id, created_by)
  );

drop policy if exists "prompts_delete" on public.prompts;
create policy "prompts_delete"
  on public.prompts for delete
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
    and public.can_access_template(id, workspace_id, created_by)
  );

drop policy if exists "personas_update" on public.personas;
create policy "personas_update"
  on public.personas for update
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
    and public.can_access_persona(id, created_by)
  );

drop policy if exists "personas_delete" on public.personas;
create policy "personas_delete"
  on public.personas for delete
  to authenticated
  using (
    public.get_user_role(workspace_id) in ('admin', 'editor')
    and public.can_access_persona(id, created_by)
  );

-- ⚠️ `prompts_insert` und `personas_insert` bleiben rollenbasiert und bekommen KEINE
-- Sichtbarkeitspruefung. Beim Anlegen gibt es noch keine Zeile, die man sehen koennte — die Frage
-- stellt sich dort nicht, und eine Pruefung hineinzuschreiben waere Symmetrie um ihrer selbst willen.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · SQEM-343 · Wie viele Objekte wuerde eine Herabstufung unerreichbar machen?
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Gezaehlt werden Templates und Personas, die diese Person erstellt hat UND die eingeschraenkt sind
-- — also alles, was nach Teil 1 niemand mehr aendern koennte, sobald sie Member ist.
--
-- ⚠️ Dateien werden NICHT gezaehlt, und das ist kein Versehen. `workspace_files` ist eine
-- workspace-weite Bibliothek: jedes Mitglied sieht sie, es gibt kein „Only me" darauf, also
-- entsteht dort keine Sackgasse. Sie ziehen bei der Uebergabe trotzdem mit (siehe unten) — aber
-- eine Zahl, die etwas anderes zaehlt als sie behauptet, waere schlimmer als keine Zahl.

create or replace function public.count_restricted_content_for_member(
  p_workspace_id uuid, p_user_id uuid
)
returns table (templates integer, personas integer)
language plpgsql stable security definer set search_path = public as $$
begin
  -- ⛔ Security-definer-Funktion: der AUFRUFER muss Admin dieses Workspace sein. Ohne diese Zeile
  -- waere das eine Auskunft darueber, wie viele private Objekte eine beliebige Person besitzt.
  if public.get_user_role(p_workspace_id) <> 'admin' then
    raise exception 'Only a workspace admin may count restricted content';
  end if;

  return query
  select
    (select count(*)::integer from public.prompts p
      where p.workspace_id = p_workspace_id
        and p.created_by = p_user_id
        and exists (select 1 from public.template_access ta where ta.template_id = p.id)),
    (select count(*)::integer from public.personas pe
      where pe.workspace_id = p_workspace_id
        and pe.created_by = p_user_id
        and exists (select 1 from public.persona_access pa where pa.persona_id = pe.id));
end;
$$;

comment on function public.count_restricted_content_for_member(uuid, uuid) is
  'SQEM-343 — how many of this person''s templates and personas carry access rules, i.e. how many '
  'become unreachable-for-everyone once they are a member and the write policies require visibility. '
  'Admin-only: the count itself is information about someone else''s private work. Files are '
  'deliberately not counted — the workspace file library has no "only me" state, so no dead end.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 3 · SQEM-343 · „Freigeben" — die prinzipienlose Zeile faellt, das Objekt wird wieder erreichbar
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Der zweite der drei Wege beim Herabstufen. Entfernt NUR die prinzipienlose Zeile („Only me"), nicht
-- benannte Zugriffe.
--
-- ⚠️ Das ist der Unterschied zwischen „freigeben" und „Einschraenkung aufheben": traegt ein Objekt
-- zusaetzlich benannte Personen oder Gruppen, bleiben die stehen und das Objekt ist danach fuer
-- genau diese erreichbar — nicht fuer alle. Nur wo die prinzipienlose Zeile die einzige war, wird es
-- workspace-weit sichtbar.
--
-- ⛔ Es bricht ein Versprechen an eine Person, die noch da ist. Deshalb ist es eine Wahl eines
-- Admins und kein Automatismus, und deshalb gibt die Funktion zurueck, was sie getan hat.

create or replace function public.release_restricted_content(
  p_workspace_id uuid, p_user_id uuid
)
returns table (templates integer, personas integer)
language plpgsql security definer set search_path = public as $$
declare
  t_count integer;
  p_count integer;
begin
  if public.get_user_role(p_workspace_id) <> 'admin' then
    raise exception 'Only a workspace admin may release restricted content';
  end if;

  with removed as (
    delete from public.template_access ta
    using public.prompts p
    where ta.template_id = p.id
      and p.workspace_id  = p_workspace_id
      and p.created_by    = p_user_id
      and ta.role is null and ta.user_id is null and ta.group_id is null
    returning ta.id
  )
  select count(*)::integer into t_count from removed;

  with removed as (
    delete from public.persona_access pa
    using public.personas pe
    where pa.persona_id = pe.id
      and pe.workspace_id = p_workspace_id
      and pe.created_by   = p_user_id
      and pa.user_id is null and pa.group_id is null
    returning pa.id
  )
  select count(*)::integer into p_count from removed;

  return query select t_count, p_count;
end;
$$;

comment on function public.release_restricted_content(uuid, uuid) is
  'SQEM-343 — drops the principal-less ("only me") access row from this person''s templates and '
  'personas, so the objects stop being unreachable once they are a member. Named principals are left '
  'alone: an object that also names people stays restricted to those people. Admin-only, and never '
  'automatic — it breaks a promise to somebody who is still here, so a person has to choose it.';

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 4 · Der dritte Weg braucht keine Funktion
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- „Obhut uebertragen" ist `reassign_orphaned_content()` aus SQEM-344 — dieselbe Funktion wie beim
-- Ausscheiden, bewusst und nicht als zweite Variante. Zwei Erbfolgen driften auseinander, sobald
-- eine erweitert wird; genau das hat SQEM-344 gekostet.
--
-- ⚠️ Sie deckt Templates, Personas UND Dateien. Beim Herabstufen ziehen die Dateien also mit, obwohl
-- sie nicht mitgezaehlt werden. Kein Verlust fuer die betroffene Person — die Dateibibliothek ist
-- workspace-weit sichtbar —, aber die Oberflaeche muss es sagen, statt es zu verschweigen.
--
-- „So lassen" tut nichts. Es ist ein zulaessiger Ausgang und darf nur nicht der Standard sein.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 5 · ⛔ Die Uebergabe braucht einen Riegel — und der darf NICHT in die Funktion selbst
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Beim Bauen von Punkt 4 aufgefallen: `reassign_orphaned_content(uuid, uuid)` ist `security definer`
-- und traegt **keine** Berechtigungspruefung. Postgres vergibt `execute` auf Funktionen
-- standardmaessig an `public`, also ist sie ueber PostgREST von JEDEM Angemeldeten aufrufbar — mit
-- beliebigen Argumenten. Wer die Workspace- und Nutzer-ID kennt, konnte den Bestand einer fremden
-- Person an den aeltesten Admin uebergeben.
--
-- ⚠️ Das galt schon fuer `reassign_orphaned_templates` und ist nie aufgefallen, weil niemand die
-- Funktion je von aussen brauchte. SQEM-343 braucht sie zum ersten Mal — und deshalb faellt es jetzt
-- auf.
--
-- ⛔ **Der Riegel darf nicht in die Funktion selbst.** Sie wird aus zwei Triggern aufgerufen, und
-- dort ist `auth.uid()` NULL — eine Admin-Pruefung im Rumpf wuerde die Erbfolge beim Ausscheiden
-- lautlos abschalten, also genau den Fall brechen, fuer den es sie gibt. Stattdessen: das Recht
-- entziehen und einen Aufrufer daneben stellen, der prueft.

revoke all on function public.reassign_orphaned_content(uuid, uuid) from public;
revoke all on function public.reassign_orphaned_content(uuid, uuid) from anon;
revoke all on function public.reassign_orphaned_content(uuid, uuid) from authenticated;

-- Der eine erlaubte Weg von aussen. Duenn mit Absicht: er prueft, wer fragt, und delegiert dann an
-- dieselbe Erbfolge wie das Ausscheiden.
create or replace function public.handover_content_from_member(
  p_workspace_id uuid, p_user_id uuid
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.get_user_role(p_workspace_id) <> 'admin' then
    raise exception 'Only a workspace admin may hand over another member''s content';
  end if;

  -- ⚠️ Der Ziel-Admin wird DRINNEN bestimmt (laengste Zugehoerigkeit), nicht hier. Wer die Uebergabe
  -- ausloest, waehlt nicht, wer sie bekommt — sonst waere „Obhut uebertragen" ein Weg, sich fremde
  -- Arbeit zuzuschreiben.
  perform public.reassign_orphaned_content(p_workspace_id, p_user_id);
end;
$$;

comment on function public.handover_content_from_member(uuid, uuid) is
  'SQEM-343 — the only way to trigger the inheritance from outside the database. Thin on purpose: it '
  'checks that the caller is an admin of the workspace and delegates. The check cannot live in '
  'reassign_orphaned_content() itself, because both triggers call that with no auth.uid() and an '
  'admin test there would silently disable inheritance on departure. The receiving admin is chosen '
  'inside (longest-standing), never by the caller.';
