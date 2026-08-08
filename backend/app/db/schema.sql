-- TUNTAS core schema (Supabase Postgres)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE patterns.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS tuntas;

-- ---------------------------------------------------------------------
-- Domain: people & competencies
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tuntas.roles (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  unit_default TEXT NOT NULL DEFAULT '',
  risk_tier TEXT NOT NULL DEFAULT 'medium',
  competency_focus TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuntas.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_ref TEXT NOT NULL UNIQUE,
  pseudonym TEXT NOT NULL,
  role_code TEXT NOT NULL,
  role_title TEXT NOT NULL,
  unit TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT 'MY',
  current_level INT NOT NULL CHECK (current_level BETWEEN 1 AND 5),
  target_level INT NOT NULL CHECK (target_level BETWEEN 1 AND 5),
  availability_pct NUMERIC(5,2) NOT NULL DEFAULT 100.0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuntas.assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_ref TEXT NOT NULL,
  role_code TEXT REFERENCES tuntas.roles(code) ON DELETE SET NULL,
  assessment_type TEXT NOT NULL,
  competency_code TEXT,
  level_before INT CHECK (level_before IS NULL OR level_before BETWEEN 1 AND 5),
  level_after INT CHECK (level_after IS NULL OR level_after BETWEEN 1 AND 5),
  source TEXT NOT NULL,
  run_id UUID,
  evidence_ref TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessments_employee
  ON tuntas.assessments(employee_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_run
  ON tuntas.assessments(run_id);

CREATE TABLE IF NOT EXISTS tuntas.competencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  cluster TEXT NOT NULL,
  fsf_skill_code TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuntas.employee_competencies (
  employee_id UUID NOT NULL REFERENCES tuntas.employees(id) ON DELETE CASCADE,
  competency_id UUID NOT NULL REFERENCES tuntas.competencies(id) ON DELETE CASCADE,
  current_level INT NOT NULL CHECK (current_level BETWEEN 1 AND 5),
  target_level INT NOT NULL CHECK (target_level BETWEEN 1 AND 5),
  gap_priority INT NOT NULL DEFAULT 1,
  PRIMARY KEY (employee_id, competency_id)
);

-- ---------------------------------------------------------------------
-- Domain: policy & controls
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tuntas.policy_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_code TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  source_uri TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  effective_date DATE,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (framework_code, version)
);

CREATE TABLE IF NOT EXISTS tuntas.policy_clauses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_document_id UUID NOT NULL REFERENCES tuntas.policy_documents(id) ON DELETE CASCADE,
  clause_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  embedding vector(768),
  UNIQUE (policy_document_id, clause_ref)
);

CREATE TABLE IF NOT EXISTS tuntas.controls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  framework_codes TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tuntas.clause_control_links (
  clause_id UUID NOT NULL REFERENCES tuntas.policy_clauses(id) ON DELETE CASCADE,
  control_id UUID NOT NULL REFERENCES tuntas.controls(id) ON DELETE CASCADE,
  PRIMARY KEY (clause_id, control_id)
);

CREATE TABLE IF NOT EXISTS tuntas.control_competency_links (
  control_id UUID NOT NULL REFERENCES tuntas.controls(id) ON DELETE CASCADE,
  competency_id UUID NOT NULL REFERENCES tuntas.competencies(id) ON DELETE CASCADE,
  PRIMARY KEY (control_id, competency_id)
);

-- ---------------------------------------------------------------------
-- Domain: vendors / courses
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tuntas.providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'MY',
  website TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tuntas.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES tuntas.providers(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  delivery_mode TEXT NOT NULL,
  cost_myr NUMERIC(12,2) NOT NULL,
  duration_hours NUMERIC(8,2) NOT NULL DEFAULT 8,
  competency_codes TEXT[] NOT NULL DEFAULT '{}',
  framework_codes TEXT[] NOT NULL DEFAULT '{}',
  data_residency TEXT NOT NULL DEFAULT 'MY',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tuntas.vendor_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID REFERENCES tuntas.providers(id) ON DELETE SET NULL,
  course_id UUID REFERENCES tuntas.courses(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash TEXT NOT NULL,
  fixture BOOLEAN NOT NULL DEFAULT false,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_evidence_content_hash
  ON tuntas.vendor_evidence(content_hash);

-- ---------------------------------------------------------------------
-- Domain: workflow runs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tuntas.workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL,
  thread_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  trigger_schema_version TEXT NOT NULL DEFAULT 'v1',
  trigger_payload JSONB NOT NULL,
  trigger_hash TEXT NOT NULL,
  current_node TEXT,
  selected_option_id UUID,
  error_message TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_request ON tuntas.workflow_runs(request_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON tuntas.workflow_runs(status);

CREATE TABLE IF NOT EXISTS tuntas.agent_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_json JSONB NOT NULL,
  citation_coverage NUMERIC(5,4),
  latency_ms INT,
  model_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuntas.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES tuntas.workflow_runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_run ON tuntas.audit_events(run_id, created_at);

CREATE TABLE IF NOT EXISTS tuntas.portfolio_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  option_key TEXT NOT NULL,
  label TEXT NOT NULL,
  total_cost_myr NUMERIC(14,2) NOT NULL,
  cost_per_employee_myr NUMERIC(12,2) NOT NULL,
  coverage_score NUMERIC(8,4) NOT NULL,
  risk_reduction_score NUMERIC(8,4) NOT NULL,
  operational_coverage NUMERIC(8,4) NOT NULL,
  hard_constraint_ok BOOLEAN NOT NULL,
  solver_status TEXT NOT NULL,
  assignments JSONB NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  challenger_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, option_key)
);

CREATE TABLE IF NOT EXISTS tuntas.approval_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES tuntas.portfolio_options(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject','revise')),
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  rationale TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuntas.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  course_code TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  delivery_mode TEXT NOT NULL,
  location TEXT,
  capacity INT NOT NULL DEFAULT 30,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tuntas.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES tuntas.sessions(id) ON DELETE CASCADE,
  employee_ref TEXT NOT NULL,
  course_code TEXT NOT NULL,
  cost_myr NUMERIC(12,2) NOT NULL,
  UNIQUE (run_id, employee_ref, course_code)
);

CREATE TABLE IF NOT EXISTS tuntas.scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  role_focus TEXT NOT NULL,
  rubric JSONB NOT NULL,
  prompt TEXT NOT NULL,
  UNIQUE (run_id, code)
);

CREATE TABLE IF NOT EXISTS tuntas.simulation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES tuntas.scenarios(id) ON DELETE CASCADE,
  employee_ref TEXT NOT NULL,
  responses JSONB NOT NULL,
  score NUMERIC(8,4) NOT NULL,
  level_awarded INT NOT NULL,
  feedback JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Adaptive multi-turn dialogue sessions (LLM turns; deterministic final rubric)
CREATE TABLE IF NOT EXISTS tuntas.simulation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES tuntas.scenarios(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  employee_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'scored', 'abandoned')),
  turns JSONB NOT NULL DEFAULT '[]'::jsonb,
  difficulty TEXT NOT NULL DEFAULT 'standard',
  attempt_id UUID REFERENCES tuntas.simulation_attempts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sim_sessions_scenario
  ON tuntas.simulation_sessions(scenario_id, employee_ref);

CREATE TABLE IF NOT EXISTS tuntas.readiness_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  employee_ref TEXT NOT NULL,
  scenario_code TEXT NOT NULL,
  attempt_id UUID REFERENCES tuntas.simulation_attempts(id) ON DELETE SET NULL,
  level_awarded INT NOT NULL,
  score NUMERIC(8,4) NOT NULL,
  evidence_hash TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'deterministic_rubric_v1',
  residual_risk JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuntas.assurance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  kirkpatrick JSONB NOT NULL,
  residual_risk JSONB NOT NULL,
  control_coverage JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Evidence Spine
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tuntas.evidence_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  external_ref TEXT NOT NULL,
  label TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, node_type, external_ref)
);

CREATE TABLE IF NOT EXISTS tuntas.evidence_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  from_node_id UUID NOT NULL REFERENCES tuntas.evidence_nodes(id) ON DELETE CASCADE,
  to_node_id UUID NOT NULL REFERENCES tuntas.evidence_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  weight NUMERIC(8,4) NOT NULL DEFAULT 1.0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_node_id, to_node_id, edge_type)
);

CREATE TABLE IF NOT EXISTS tuntas.artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  storage_path TEXT,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  hmac_signature TEXT NOT NULL,
  byte_size INT NOT NULL,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuntas.outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES tuntas.workflow_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Client Idempotency-Key for POST /decision (and future mutations)
CREATE TABLE IF NOT EXISTS tuntas.mutation_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, idempotency_key)
);

-- Append-only guard for audit_events
CREATE OR REPLACE FUNCTION tuntas.deny_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_no_update ON tuntas.audit_events;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE OR DELETE ON tuntas.audit_events
  FOR EACH ROW EXECUTE FUNCTION tuntas.deny_audit_mutation();

-- RLS: enable; backend uses service role for writes; anon/authenticated read scoped later
ALTER TABLE tuntas.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuntas.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuntas.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuntas.portfolio_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuntas.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuntas.evidence_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tuntas.evidence_edges ENABLE ROW LEVEL SECURITY;

-- Development-friendly policies for authenticated users (read).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='tuntas' AND tablename='workflow_runs' AND policyname='auth_read_runs'
  ) THEN
    CREATE POLICY auth_read_runs ON tuntas.workflow_runs
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
