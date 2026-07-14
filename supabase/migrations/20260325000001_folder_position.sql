-- Add position column to folders for drag-and-drop ordering
alter table public.folders add column position integer not null default 0;

-- Backfill existing rows with sequential positions per workspace based on created_at
with ordered as (
  select id, row_number() over (partition by workspace_id order by created_at) - 1 as pos
  from public.folders
)
update public.folders f set position = o.pos from ordered o where f.id = o.id;
