-- ensure pgcrypto is available for gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- webhooks: inbound trigger URLs linked to automatable prompts
CREATE TABLE public.webhooks (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID        NOT NULL,
  name          TEXT        NOT NULL,
  prompt_id     UUID        NOT NULL,
  input_mapping JSONB       NOT NULL DEFAULT '{}',
  outbound_url  TEXT,
  secret        TEXT        NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhooks_select" ON public.webhooks FOR SELECT TO authenticated
  USING (public.get_user_role(workspace_id) = 'admin');

CREATE POLICY "webhooks_insert" ON public.webhooks FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role(workspace_id) = 'admin');

CREATE POLICY "webhooks_delete" ON public.webhooks FOR DELETE TO authenticated
  USING (public.get_user_role(workspace_id) = 'admin');

GRANT SELECT, INSERT, DELETE ON public.webhooks TO authenticated;

-- webhook_deliveries: log of outbound delivery attempts
CREATE TABLE public.webhook_deliveries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id   UUID        NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_code  INTEGER,
  response_body TEXT,
  attempt      INTEGER     NOT NULL DEFAULT 1,
  success      BOOLEAN     NOT NULL DEFAULT FALSE
);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_deliveries_select" ON public.webhook_deliveries FOR SELECT TO authenticated
  USING (
    webhook_id IN (
      SELECT id FROM public.webhooks
      WHERE public.get_user_role(workspace_id) = 'admin'
    )
  );

GRANT SELECT ON public.webhook_deliveries TO authenticated;
