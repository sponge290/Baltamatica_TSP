-- Supabase migration: TSP solutions storage
-- Generated from project/scripts/supabase_init.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.tsp_solutions (
  solution_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id INTEGER NOT NULL,
  algorithm TEXT NOT NULL,
  total_cost DOUBLE PRECISION NOT NULL,
  total_time DOUBLE PRECISION NOT NULL,
  reliability DOUBLE PRECISION,
  exec_time DOUBLE PRECISION NOT NULL,
  route_sequence JSONB NOT NULL,
  nodes JSONB,
  process_data JSONB,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsp_solutions_case_id ON public.tsp_solutions(case_id);
CREATE INDEX IF NOT EXISTS idx_tsp_solutions_created_at ON public.tsp_solutions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsp_solutions_is_public ON public.tsp_solutions(is_public);

ALTER TABLE public.tsp_solutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Public can read public solutions"
  ON public.tsp_solutions
  FOR SELECT
  USING (is_public = true);

-- Edge Functions typically use the Service Role key (bypasses RLS).
-- These policies allow inserts/updates if you ever write via anon/auth keys.
CREATE POLICY IF NOT EXISTS "Anyone can insert solutions"
  ON public.tsp_solutions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Anyone can update solutions"
  ON public.tsp_solutions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

