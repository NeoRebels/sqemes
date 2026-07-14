-- Enable Supabase Realtime for prompts and history_items so that
-- all connected clients receive live updates when other workspace
-- members create, edit, or delete records.
ALTER PUBLICATION supabase_realtime ADD TABLE prompts;
ALTER PUBLICATION supabase_realtime ADD TABLE history_items;
