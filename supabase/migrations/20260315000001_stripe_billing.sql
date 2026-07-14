-- Add Stripe billing columns to workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- Track billing cycle (monthly/yearly) for paid workspaces
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS billing_cycle text DEFAULT 'monthly';
