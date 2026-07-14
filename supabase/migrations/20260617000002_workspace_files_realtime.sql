-- Enable realtime for workspace_files so extraction_status updates
-- reach the client without requiring a page reload.
ALTER PUBLICATION supabase_realtime ADD TABLE workspace_files;
