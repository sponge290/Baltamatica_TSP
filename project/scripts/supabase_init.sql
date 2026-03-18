-- Supabase (PostgreSQL) initialization script for this project.
-- Focus: store TSP solutions produced by Supabase Edge Functions.
--
-- Run this in Supabase SQL editor.

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core table: solutions
CREATE TABLE IF NOT EXISTS tsp_solutions (
  solution_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id INTEGER NOT NULL,
  algorithm TEXT NOT NULL, -- DP, A*, GA
  total_cost DOUBLE PRECISION NOT NULL,
  total_time DOUBLE PRECISION NOT NULL, -- minutes
  reliability DOUBLE PRECISION,
  exec_time DOUBLE PRECISION NOT NULL, -- ms
  route_sequence JSONB NOT NULL, -- array of city indices/ids
  nodes JSONB, -- array of node objects for visualization
  process_data JSONB, -- algorithm internal process (optional)
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsp_solutions_case_id ON tsp_solutions(case_id);
CREATE INDEX IF NOT EXISTS idx_tsp_solutions_created_at ON tsp_solutions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsp_solutions_is_public ON tsp_solutions(is_public);

-- RLS
ALTER TABLE tsp_solutions ENABLE ROW LEVEL SECURITY;

-- Public read for shared solutions + history listing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tsp_solutions'
      AND policyname = 'Public can read public solutions'
  ) THEN
    CREATE POLICY "Public can read public solutions"
      ON tsp_solutions
      FOR SELECT
      USING (is_public = true);
  END IF;
END $$;

-- Edge Function uses Service Role key, so it can bypass RLS.
-- Still create an insert policy for completeness (useful if you ever write with anon/auth keys).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tsp_solutions'
      AND policyname = 'Anyone can insert solutions'
  ) THEN
    CREATE POLICY "Anyone can insert solutions"
      ON tsp_solutions
      FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tsp_solutions'
      AND policyname = 'Anyone can update solutions'
  ) THEN
    CREATE POLICY "Anyone can update solutions"
      ON tsp_solutions
      FOR UPDATE
      USING (true);
  END IF;
END $$;

