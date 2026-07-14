-- Remove the inbound/outbound webhook system (SQEM-054).
-- MCP replaces both inbound triggers and outbound notifications.

-- Drop webhook tables
drop table if exists webhook_deliveries;
drop table if exists webhooks;

-- Drop webhook-related columns from prompts
alter table prompts
  drop column if exists automatable,
  drop column if exists outbound_urls,
  drop column if exists notification_secret;
