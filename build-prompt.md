# AI Deployment Guardian — Master Build Prompt

Use this prompt as the opening context message in any AI-assisted coding session for this project. Paste it in full before asking implementation questions.

---

## The Prompt

```
You are helping me build "AI Deployment Guardian" — an autonomous agentic AI system that acts as an intelligent quality gate for production deployments. It predicts blast radius before deploy, monitors live telemetry during deploy, and auto-investigates + rolls back post-deploy.

---

## PRODUCT SUMMARY

The core problem: CI/CD pipelines are fast but blind. Teams deploy multiple times a day with no way to know the blast radius of a change until something breaks. Existing tools (Harness, Datadog, ArgoCD) are rule-based, reactive, and dashboard-driven — they give you alerts, not answers.

This system solves that with a Gemini-powered agent that reasons like a senior SRE: it predicts impact before deploy using real runtime topology from Dynatrace, watches live telemetry during the rollout, and when something goes wrong, investigates root cause by correlating distributed traces with the code diff — then decides whether to roll back automatically.

---

## TECH STACK

- AI Brain: Gemini 2.5 Pro (Vertex AI) with function calling (tool-use / ReAct loop)
- Observability: Dynatrace (metrics, traces, logs, topology) via Dynatrace MCP Server
- CI/CD integration: GitHub Actions (webhook trigger + workflow_dispatch for rollback/pause)
- Backend: Python (FastAPI), deployed on Google Cloud Run
- Database: PostgreSQL (SQLAlchemy + Alembic) — stores Flight Recorder and Risk Profiles
- Frontend: React with Mermaid/D3 for topology visualization, SSE for real-time updates
- Telemetry pipeline: OpenTelemetry + Bindplane feeding Dynatrace

---

## AGENT DESIGN

The agent uses a ReAct loop (Reason → Act → Observe → Repeat) with Gemini 2.5 Pro as the reasoning model. It manages a `DeploymentSession` state object that progresses through a finite state machine:

  IDLE → PRE_DEPLOY_ANALYSIS → RISK_SCORED → BASELINE_CAPTURED → MONITORING_LIVE
       → INVESTIGATING → ROLLING_BACK / AWAITING_HUMAN → ROLLED_BACK / APPROVED
       → STEADY_STATE_CONFIRMED → IDLE

The agent has 15 callable skills registered as Gemini function declarations. It decides which skills to call and in what order based on the deployment context. It never calls a fixed sequence — it reasons about what information it needs next.

Key behaviors:
- Temperature is set to 0.1 for deterministic production decisions
- Confidence < 0.75 → continue monitoring (don't act)
- Confidence ≥ 0.85 + severity = critical → auto-rollback
- Rollback safety is always checked before executing rollback (DB migrations may be irreversible)
- Everything gets written to the Flight Recorder at session end

---

## 15 SKILLS (tools available to the agent)

Each skill is a Python async function in the `skills/` module and a registered Gemini function declaration:

PRE-DEPLOY:
  S1  fetch_service_topology(service_id, depth=3)
      → Queries Dynatrace topology graph for the target service and all transitive dependents
  S2  map_diff_to_services(repo, commit_sha, base_sha, topology)
      → Calls GitHub compare API, maps changed files to services via service-map.json
  S3  score_blast_radius(topology, diff_analysis, historical_incidents)
      → Gemini produces risk_score (low/medium/high/critical), impact_map, risk_factors
  S4  snapshot_baseline_metrics(service_ids, lookback_window="30m")
      → Captures p50/p99/error_rate/rps from Dynatrace for all blast-radius services
  S5  evaluate_natural_language_policy(policies, context)
      → Two-step Gemini call: parse policy → fetch Dynatrace metric → evaluate → pass/block

DURING DEPLOY:
  S6  monitor_live_telemetry(service_ids, baseline, poll_interval_sec=60)
      → Polls Dynatrace every 60s, returns current metrics + delta from baseline
  S7  detect_anomaly(current_metrics, baseline, historical_variance, deploy_age_minutes)
      → Gemini reasons: real regression or noise? Returns is_anomaly, confidence, recommendation
  S8  pause_canary(deployment_id, reason)
      → Dispatches pause signal to GitHub Actions or ArgoCD

POST-DEPLOY / INVESTIGATION:
  S9  fetch_failing_traces(service_id, time_range, error_filter=True, limit=50)
      → Pulls distributed traces for failing requests from Dynatrace
  S10 identify_root_cause(traces, metric_deltas, deployment_diff, risk_profile)
      → 3-step Gemini chain: trace analysis → diff correlation → verdict with confidence
  S11 check_rollback_safety(deployment_diff, root_cause, migration_registry)
      → Checks if DB migrations are reversible; queries write volume since deploy
  S12 execute_rollback(deployment_id, rollback_to_sha, include_db_rollback)
      → Dispatches rollback.yml workflow via GitHub Actions workflow_dispatch

ALWAYS (at session end):
  S13 write_flight_recorder_entry(session)
      → Persists full forensic record: diff summary, baseline, anomaly, RCA, reasoning chain

BACKGROUND (scheduled):
  S14 detect_cross_deploy_regression(lookback_window="7d", degradation_threshold_pct=15)
      → Finds metric degradations with no recent deploy in that service; traces to older deploys
  S15 profile_developer_risk(service_id, change_categories)
      → Returns per-service+change-type incident rate from historical Flight Recorder data

---

## KEY UNIQUE FEATURES

1. Blast Radius Prediction — pre-deploy, not post-incident. Uses Dynatrace runtime topology.
2. Natural Language Policies — "Don't deploy if error rate > 2% in last hour" → enforced by agent.
3. Deployment Flight Recorder — full forensic timeline auto-generated for every deployment.
4. Developer Risk Profiling — learns from historical Dynatrace data which change types are risky per service.
5. Cross-Deploy Regression Detection — finds regressions caused by a deploy that happened days ago.

---

## PROJECT FILE STRUCTURE

guardian/
├── api/
│   ├── routes/deployments.py      # POST /api/v1/deployments
│   ├── routes/scans.py            # POST /api/v1/scans/cross-deploy
│   └── routes/records.py          # GET /api/v1/records/:id
├── agent/
│   ├── session.py                 # DeploymentSession dataclass + FSM transitions
│   ├── loop.py                    # Gemini ReAct reasoning loop
│   ├── prompts.py                 # System prompt builder
│   └── decisions.py               # Threshold evaluation + escalation matrix
├── skills/
│   ├── topology.py                # S1
│   ├── diff.py                    # S2
│   ├── blast_radius.py            # S3
│   ├── baseline.py                # S4
│   ├── policy.py                  # S5
│   ├── monitor.py                 # S6
│   ├── anomaly.py                 # S7
│   ├── canary.py                  # S8
│   ├── traces.py                  # S9
│   ├── root_cause.py              # S10
│   ├── rollback_safety.py         # S11
│   ├── rollback.py                # S12
│   ├── flight_recorder.py         # S13
│   ├── cross_deploy.py            # S14
│   └── risk_profile.py            # S15
├── integrations/
│   ├── dynatrace/mcp_adapter.py   # Dynatrace MCP → Python client
│   ├── cicd/github_actions.py     # GitHub Actions adapter
│   └── notifications/slack.py     # Slack + GitHub PR comments
├── db/
│   ├── models.py                  # SQLAlchemy: deployment_records, service_risk_profiles
│   └── migrations/                # Alembic
└── config/loader.py               # guardian.config.json validator

frontend/
├── src/
│   ├── pages/
│   │   ├── DeploymentLive.tsx     # Real-time deploy view (SSE)
│   │   ├── FlightRecorder.tsx     # Historical deploy records
│   │   ├── PolicyEditor.tsx       # Natural language policy UI
│   │   └── RiskProfiles.tsx       # Per-service risk charts
│   └── components/
│       ├── TopologyGraph.tsx      # D3 force graph for blast radius
│       ├── MetricsChart.tsx       # Recharts: live vs baseline overlay
│       └── ReasoningChain.tsx     # Step-by-step agent log

---

## DATABASE SCHEMA (PostgreSQL)

deployment_records:
  id UUID, created_at, repo, service, commit_sha, base_sha, deployment_id,
  commit_message, triggered_by, outcome (approved|rolled_back|paused|blocked_by_policy),
  deploy_started_at, deploy_completed_at, risk_score, blast_radius JSONB,
  baseline_metrics JSONB, peak_metrics JSONB, anomaly_detected BOOL,
  anomaly_type, root_cause_analysis JSONB, rollback_executed BOOL,
  policy_evaluation JSONB, reasoning_chain JSONB, steady_state_confirmed_at

service_risk_profiles:
  id UUID, service, change_category, total_deploys, incident_deploys,
  incident_rate FLOAT, last_incident_at, incidents_summary JSONB
  UNIQUE(service, change_category)

---

## CONFIGURATION (guardian.config.json — in each repo)

{
  "dynatrace": { "environment_id": "...", "mcp_server_url": "...", "api_token_secret": "DYNATRACE_API_TOKEN" },
  "cicd_adapter": "github_actions",
  "service_map": "./service-map.json",
  "migration_registry": "./db/migrations/registry.json",
  "policies": [
    "Don't deploy to production if error rate on checkout exceeded 2% in the last hour",
    "Block deploys on Fridays after 3 PM unless approved by on-call",
    "Allow canary to proceed only if p99 latency stays under 500ms for 10 minutes"
  ],
  "canary": { "initial_pct": 5, "step_pct": 20, "step_interval_minutes": 10,
              "auto_rollback_on_critical": true, "require_human_approval_on_high": true },
  "notifications": { "slack_webhook_secret": "SLACK_WEBHOOK_URL", "github_pr_comments": true }
}

---

## DECISION THRESHOLDS

| Condition                                    | Auto Action      | Human Escalation |
|----------------------------------------------|------------------|------------------|
| Policy blocks deploy                          | Block            | Notify on-call   |
| Risk = critical                               | Block + approval | Required         |
| Risk = high                                   | Canary only 5%   | Notify team      |
| Anomaly confidence ≥ 0.85 + severity=critical | Auto-rollback    | Notify on-call   |
| Anomaly confidence ≥ 0.75 + severity=high     | Pause canary     | Notify team      |
| Anomaly confidence < 0.75                     | Keep monitoring  | None             |
| Rollback safety = false                       | Do NOT rollback  | Required         |

---

## GEMINI CLIENT SETUP

vertexai.init(project="gcp-project-id", location="us-central1")
model = GenerativeModel(
  model_name="gemini-2.5-pro",
  generation_config=GenerationConfig(temperature=0.1, top_p=0.8, max_output_tokens=8192),
  system_instruction=GUARDIAN_SYSTEM_PROMPT
)

Function calling mode: AUTO — Gemini decides when to call tools.

---

## DEMO FLOW (3-minute video)

1. Push commit to payment-service with DB migration in diff
2. Guardian: blast radius → 4 services, HIGH risk (DB migration, 3/5 incident history)
3. Natural language policy check passes
4. Canary starts at 5% — chaos agent injects 2000ms DB latency at T+2min
5. Guardian detects: p99 180ms → 2100ms, error rate 0.12% → 8.4%
6. Fetches 847 failing traces → all timeout at DB call
7. Correlates with diff → migrate_v3.sql line 14: CREATE INDEX without CONCURRENTLY
8. Checks rollback safety → index creation is reversible → safe
9. Auto-rollback triggered → GitHub Actions rollback.yml dispatched
10. Flight recorder written → PR comment with full RCA and reasoning chain

---

Now help me implement: [DESCRIBE THE SPECIFIC COMPONENT OR TASK YOU WANT TO BUILD]
```

---

## Focused Sub-Prompts (use these for specific implementation tasks)

Copy the master prompt above, then append the relevant sub-prompt below.

---

### To build the Gemini ReAct reasoning loop (`agent/loop.py`):
```
Implement the Gemini ReAct reasoning loop in Python. It should:
- Accept a DeploymentSession object and a GuardianConfig
- Build a messages list starting with the system prompt and initial trigger message
- Call gemini_client.generate_content() with all 15 skill tool definitions registered as function declarations
- Parse function_call parts from the response and route them to the correct skill via execute_skill()
- Append each tool result back to messages as a function_response
- Log every skill call as a ReasoningStep in session.reasoning_chain
- Handle context compression when messages > 80 turns (keep first 2, last 10, compress middle into summary)
- Break the loop when session.state reaches a terminal state (IDLE, BLOCKED_BY_POLICY, ROLLED_BACK, STEADY_STATE_CONFIRMED)
- Always call write_flight_recorder_entry at session end regardless of how the loop exits
Use asyncio throughout. Show the complete implementation.
```

---

### To build the Dynatrace MCP adapter (`integrations/dynatrace/mcp_adapter.py`):
```
Implement the DynatraceMCPAdapter Python class. It needs these async methods:
1. query_metrics(metric_selector, entity_selector, from_time, to_time, resolution="1m")
   → POST /api/v2/metrics/query, returns parsed metric timeseries
2. get_topology(entity_id, depth=3)
   → BFS traversal of /api/v2/topology/services using toRelationships.calls, returns dependency graph
3. get_traces(entity_id, from_time, to_time, error_only=True, limit=50)
   → GET /api/v2/traces with entitySelector and errorType=FAILED_REQUEST filter
4. get_entity(entity_id)
   → GET /api/v2/entities/{entity_id}, returns entity metadata

Use httpx.AsyncClient with proper timeout (10s for metrics, 30s for traces). Include retry logic (3 attempts, exponential backoff) for 429 and 503 responses. Raise a DynatraceUnavailableError on persistent failure so the agent can fall back to cached topology.
```

---

### To build the blast radius scorer (`skills/blast_radius.py`):
```
Implement the score_blast_radius skill in Python. It should:
1. Accept topology (from S1), diff_analysis (from S2), historical_incidents (from S15)
2. Build a structured Gemini prompt that includes all three inputs as JSON context
3. Call Gemini with response_mime_type="application/json" and temperature=0.1
4. Parse the response into a BlastRadiusResult dataclass with fields:
   risk_score: Literal["low","medium","high","critical"]
   risk_reasoning: str
   impact_map: dict[str, Literal["none","low","medium","high"]]
   risk_factors: list[str]
5. Include validation: if Gemini returns invalid JSON or missing fields, retry once, then raise SkillExecutionError
Show the full prompt template and the complete Python implementation.
```

---

### To build the natural language policy engine (`skills/policy.py`):
```
Implement the evaluate_natural_language_policy skill. It uses a two-step Gemini process:
Step 1 — Policy Parsing: For each policy string, call Gemini to extract a structured check:
  { metric, service, threshold, window, operator (gt/lt/eq), action (block/warn), time_condition? }
Step 2 — Metric Fetch + Evaluate: Use the structured check to query the correct Dynatrace metric
  via the MCP adapter, then have Gemini produce a pass/block decision with a plain-English reason.
The function should return a PolicyEvalResult with:
  overall_decision: "pass" | "block"
  policy_results: list of per-policy decisions with metric_value, threshold, reason
Handle time-based conditions (e.g. "Fridays after 3 PM") using the context.current_time field.
Show the Gemini prompt templates for both steps and the full implementation.
```

---

### To build the root cause analysis skill (`skills/root_cause.py`):
```
Implement the identify_root_cause skill using a 3-step Gemini chain:
Step 1 — Trace Analysis prompt: Given sample_traces from S9 and metric_deltas from S7,
  identify: origin_service (where error starts, not where it propagates), error_type, error_pattern.
Step 2 — Diff Correlation prompt: Given origin_service + error_type from Step 1 and the deployment
  diff (file list + categories from S2), determine: is there a specific file/change that explains
  this error? If yes, quote the implicated file and describe why it causes this error.
Step 3 — Final Verdict prompt: Combine Step 1 and Step 2 into a RootCauseResult:
  root_service, root_cause_description, implicated_change, confidence (0.0-1.0), recommended_action
Each step uses the output of the previous as input. Use temperature=0.1 for all three calls.
Show all three prompt templates and the chaining implementation.
```

---

### To build the flight recorder (`skills/flight_recorder.py` + `db/models.py`):
```
Implement the Flight Recorder system:
1. SQLAlchemy model `DeploymentRecord` matching this schema:
   id (UUID PK), created_at, repo, service, commit_sha, base_sha, deployment_id,
   commit_message, triggered_by, outcome (Enum: approved/rolled_back/paused/blocked_by_policy),
   deploy_started_at, deploy_completed_at, risk_score (Enum: low/medium/high/critical),
   blast_radius (JSONB), baseline_metrics (JSONB), peak_metrics (JSONB),
   anomaly_detected (Boolean), anomaly_type (String), root_cause_analysis (JSONB),
   rollback_executed (Boolean), policy_evaluation (JSONB), reasoning_chain (JSONB),
   steady_state_confirmed_at (Nullable Timestamp)
2. write_flight_recorder_entry(session: DeploymentSession) async function that:
   - Extracts all populated fields from the session object
   - Computes deploy_duration_minutes from started_at to now
   - Writes the record to PostgreSQL using async SQLAlchemy
   - Updates service_risk_profiles table: increments total_deploys, conditionally increments
     incident_deploys if outcome is rolled_back or anomaly_detected is True
   - Returns the record UUID
Use SQLAlchemy 2.0 async style with asyncpg driver.
```

---

### To build the React live deployment view (`frontend/src/pages/DeploymentLive.tsx`):
```
Implement the live deployment view React component. It should:
1. Connect to GET /api/v1/deployments/:id/stream via EventSource (SSE) to receive live updates
2. Display a header with: service name, version, risk score badge (color-coded), current state chip
3. Four tabs:
   a. Risk Assessment: D3 force-directed graph showing the blast radius topology. Nodes are
      services, edges are dependencies, node color = predicted impact (green/yellow/orange/red).
   b. Live Metrics: Recharts LineChart showing p99 latency and error rate over time.
      Two lines per chart: baseline (dashed) and current (solid). Auto-updates via SSE.
   c. Investigation: Only visible when state is INVESTIGATING or ROLLING_BACK.
      Shows root_cause_description, implicated_change, confidence bar, recommended_action badge.
   d. Reasoning Chain: Scrollable log of ReasoningStep entries with timestamp, skill name,
      and output_summary. Auto-scrolls to bottom on new entries.
4. Action bar at bottom: "Approve Deploy" button (green), "Force Rollback" button (red),
   "Notify On-Call" button (orange). All call POST /api/v1/deployments/:id/actions.
Use TypeScript, React hooks, Tailwind CSS. Show complete component implementation.
```

---

### To build the GitHub Actions integration:
```
Implement two things:
1. The guardian-action GitHub Action (action.yml + index.js):
   - Inputs: event (pre_deploy|deploy_complete|rollback_complete), service, commit_sha,
     base_sha, deployment_id, guardian_url, guardian_token
   - Posts to guardian_url/api/v1/deployments with HMAC-signed payload (using guardian_token)
   - Polls GET /api/v1/deployments/:id/status every 10 seconds until state is not PRE_DEPLOY_ANALYSIS
   - If outcome is "blocked_by_policy": set-output decision=block, exit 1
   - If outcome is "approved" or "monitoring": set-output decision=proceed, exit 0
   
2. The rollback.yml workflow template (teams add to their repo):
   - Trigger: workflow_dispatch with inputs: deployment_id, rollback_to_sha, include_db_rollback
   - Steps: checkout rollback_to_sha → run tests → deploy → optionally run migrate down
   - On complete: notify Guardian via action with event=rollback_complete

Show both complete implementations.
```

---

## Quick-Start Checklist

Before starting any implementation session, confirm:
- [ ] GCP project created with Vertex AI API enabled
- [ ] Dynatrace environment provisioned with MCP server configured
- [ ] GitHub App created with permissions: contents (read), deployments (write), pull_requests (write)
- [ ] PostgreSQL instance running (Cloud SQL or local Docker)
- [ ] `guardian.config.json` added to target repo with `service-map.json`
- [ ] `DYNATRACE_API_TOKEN`, `GEMINI_PROJECT_ID`, `GITHUB_APP_PRIVATE_KEY`, `DATABASE_URL` set as secrets
- [ ] `rollback.yml` workflow template added to target repo
