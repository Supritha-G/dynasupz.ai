# AI Deployment Guardian — Skills Reference

Skills are the discrete, callable units of capability the agent uses during its reasoning loop. Each skill maps to one or more Dynatrace MCP calls, Gemini tool calls, or CI/CD API calls. The agent orchestrates skills in sequence or in parallel depending on the deployment phase.

---

## Skill Inventory

| ID | Skill Name | Phase | Primary Data Source |
|----|------------|-------|---------------------|
| S1 | `fetch_service_topology` | Pre-deploy | Dynatrace MCP |
| S2 | `map_diff_to_services` | Pre-deploy | GitHub API + Dynatrace |
| S3 | `score_blast_radius` | Pre-deploy | Gemini + Historical metrics |
| S4 | `snapshot_baseline_metrics` | Pre-deploy | Dynatrace MCP |
| S5 | `evaluate_natural_language_policy` | Pre-deploy / Live | Gemini |
| S6 | `monitor_live_telemetry` | During deploy | Dynatrace MCP |
| S7 | `detect_anomaly` | During deploy | Gemini + Dynatrace |
| S8 | `pause_canary` | During deploy | GitHub Actions / ArgoCD API |
| S9 | `fetch_failing_traces` | Post-deploy | Dynatrace MCP |
| S10 | `identify_root_cause` | Post-deploy | Gemini (multi-step) |
| S11 | `check_rollback_safety` | Post-deploy | Dynatrace + Migration registry |
| S12 | `execute_rollback` | Post-deploy | GitHub Actions / ArgoCD API |
| S13 | `write_flight_recorder_entry` | Post-deploy | Internal DB |
| S14 | `detect_cross_deploy_regression` | Continuous | Dynatrace MCP + Flight Recorder |
| S15 | `profile_developer_risk` | Background | Dynatrace historical + Flight Recorder |

---

## Skill Specifications

---

### S1 — `fetch_service_topology`

**Purpose:** Retrieve the live runtime service dependency graph for the target service and all transitive dependents.

**Trigger:** Called at the start of every pre-deploy phase.

**Inputs:**
```json
{
  "service_id": "string",          // Dynatrace entity ID, e.g. "SERVICE-ABC123"
  "depth": "integer (default: 3)"  // How many hops of downstream deps to fetch
}
```

**Dynatrace MCP Calls:**
```
GET /api/v2/topology/processes?entitySelector=type(SERVICE),entityId({service_id})
GET /api/v2/topology/services?relatedEntitySelector=toRelationship.calls({service_id})
```

**Output:**
```json
{
  "root_service": "payment-service",
  "dependency_graph": {
    "payment-service": ["order-service", "fraud-service", "notification-service"],
    "order-service": ["inventory-service"],
    "fraud-service": []
  },
  "total_affected_services": 4,
  "dynatrace_entity_ids": { "payment-service": "SERVICE-ABC123", "...": "..." }
}
```

**Error handling:** If Dynatrace MCP is unreachable, fall back to the last known topology snapshot stored in the Flight Recorder DB. Log the fallback in the reasoning chain.

---

### S2 — `map_diff_to_services`

**Purpose:** Parse the Git diff for a deployment and determine which Dynatrace-monitored services are touched by the code changes.

**Trigger:** Called immediately after S1.

**Inputs:**
```json
{
  "repo": "string",           // e.g. "org/payment-service"
  "commit_sha": "string",
  "base_sha": "string",
  "topology": "object"        // output from S1
}
```

**Implementation:**
1. Call GitHub API: `GET /repos/{repo}/compare/{base_sha}...{commit_sha}` to get changed file paths.
2. Load a `service-map.json` config file from the repo root (teams maintain this) that maps file path prefixes to service names:
   ```json
   {
     "src/payment/": "payment-service",
     "src/fraud/": "fraud-service",
     "infra/db/": ["payment-service", "order-service"]
   }
   ```
3. Cross-reference changed files against the map. Flag any changes to shared infra (DB migrations, shared libraries, API contracts).

**Output:**
```json
{
  "directly_changed_services": ["payment-service"],
  "changed_file_categories": {
    "db_migration": true,
    "api_contract_change": false,
    "config_change": false,
    "business_logic": true
  },
  "changed_files_summary": ["src/payment/db/migrate_v3.sql", "src/payment/handlers/checkout.go"]
}
```

---

### S3 — `score_blast_radius`

**Purpose:** Produce a structured risk score and impact map by combining topology data, diff analysis, and historical incident patterns.

**Trigger:** Called after S1 and S2 complete. This is the primary pre-deploy output.

**Inputs:**
```json
{
  "topology": "object",           // from S1
  "diff_analysis": "object",      // from S2
  "historical_incidents": "array" // from S15 (developer risk profiles)
}
```

**Gemini Prompt (system):**
```
You are a senior SRE evaluating deployment risk. You will receive:
1. A service dependency graph
2. Analysis of what code changed
3. Historical incident data for similar changes

Your job is to produce:
- A risk_score: "low" | "medium" | "high" | "critical"
- A risk_reasoning: 2-3 sentences explaining the score
- An impact_map: for each downstream service, a predicted_impact: "none" | "low" | "medium" | "high"
- A list of risk_factors: specific reasons this deploy is risky

Be conservative. A DB migration that has caused incidents before should always be at least "high".
Output valid JSON only.
```

**Output:**
```json
{
  "risk_score": "high",
  "risk_reasoning": "This deploy includes a DB schema migration on payment-service. Historical data shows 3 of 5 past DB migrations on this service caused p99 latency spikes exceeding 200ms. Four downstream services are in the blast radius.",
  "impact_map": {
    "order-service": "high",
    "fraud-service": "medium",
    "notification-service": "low",
    "inventory-service": "low"
  },
  "risk_factors": [
    "db_migration_on_high_traffic_service",
    "peak_traffic_window",
    "4_downstream_services_affected"
  ]
}
```

---

### S4 — `snapshot_baseline_metrics`

**Purpose:** Capture a pre-deploy baseline of key metrics for the root service and all services in the blast radius. Used later to detect regressions.

**Trigger:** Called immediately before deployment begins (after policy check passes).

**Inputs:**
```json
{
  "service_ids": ["array of Dynatrace entity IDs"],
  "lookback_window": "30m"
}
```

**Dynatrace MCP Calls:**
```
POST /api/v2/metrics/query
  metricSelector: builtin:service.response.time:percentile(50),builtin:service.response.time:percentile(99),builtin:service.errors.total.rate,builtin:service.requestCount.rate
  entitySelector: entityId({service_id})
  from: now-30m
  to: now
```

**Output:**
```json
{
  "snapshot_timestamp": "2024-01-15T14:30:00Z",
  "baselines": {
    "payment-service": {
      "p50_ms": 45,
      "p99_ms": 180,
      "error_rate_pct": 0.12,
      "rps": 2400
    },
    "order-service": {
      "p50_ms": 32,
      "p99_ms": 120,
      "error_rate_pct": 0.05,
      "rps": 890
    }
  }
}
```

---

### S5 — `evaluate_natural_language_policy`

**Purpose:** Parse a team's natural language deployment policies, translate them into metric queries against Dynatrace, and return a pass/block decision with reasoning.

**Trigger:** Called before deploy begins and optionally during canary (for time-based policies).

**Inputs:**
```json
{
  "policies": ["array of plain-English policy strings"],
  "context": {
    "risk_score": "high",
    "current_time": "2024-01-15T16:45:00Z",
    "baseline_metrics": "object",
    "service_id": "string"
  }
}
```

**Implementation — Two-Step Gemini Call:**

Step 1 — Policy Parsing: Gemini converts each policy to a structured check:
```
Input: "Don't deploy if error rate on checkout exceeded 2% in the last hour"
Output: {
  "metric": "error_rate",
  "service": "checkout-service",
  "threshold": 2.0,
  "window": "1h",
  "operator": "gt",
  "action": "block"
}
```

Step 2 — Metric Fetch + Evaluate: Agent calls Dynatrace for the structured metric, then has Gemini render the final decision with explanation.

**Output:**
```json
{
  "overall_decision": "block",
  "policy_results": [
    {
      "policy": "Don't deploy to production if error rate on checkout exceeded 2% in the last hour",
      "decision": "block",
      "reason": "Current error rate on checkout-service is 3.4% over the last hour, exceeding the 2% threshold.",
      "metric_value": 3.4,
      "threshold": 2.0
    },
    {
      "policy": "Block deploys on Fridays after 3 PM unless approved by on-call",
      "decision": "pass",
      "reason": "Current time is Monday. Condition does not apply."
    }
  ]
}
```

---

### S6 — `monitor_live_telemetry`

**Purpose:** Poll Dynatrace for live metrics across all blast-radius services during a canary or rolling deployment. Runs on a configurable interval and feeds data to S7.

**Trigger:** Continuous polling loop during deploy phase. Runs every 60 seconds.

**Inputs:**
```json
{
  "service_ids": ["array of Dynatrace entity IDs"],
  "baseline": "object",    // from S4
  "poll_interval_sec": 60,
  "deploy_start_time": "ISO8601 timestamp"
}
```

**Dynatrace MCP Calls:** Same metric selectors as S4, but with `from: {deploy_start_time}` to `now`.

**Output per poll tick:**
```json
{
  "tick_timestamp": "2024-01-15T14:35:00Z",
  "metrics": {
    "payment-service": {
      "p50_ms": 52,
      "p99_ms": 340,
      "error_rate_pct": 1.8,
      "rps": 2380,
      "delta_from_baseline": {
        "p99_ms": "+88.9%",
        "error_rate_pct": "+1400%"
      }
    }
  },
  "alert_candidates": ["payment-service"]
}
```

---

### S7 — `detect_anomaly`

**Purpose:** Given a telemetry tick from S6, reason about whether the deviation is a real regression or noise. Returns a structured anomaly verdict.

**Trigger:** Called after every S6 poll tick.

**Inputs:**
```json
{
  "current_metrics": "object",
  "baseline": "object",
  "historical_variance": "object",
  "deploy_age_minutes": 5
}
```

**Gemini Prompt:**
```
You are evaluating live production metrics during a canary deployment.
Baseline metrics are pre-deploy values. Current metrics are from the last 60 seconds.
Historical variance tells you how much these metrics normally fluctuate.

Determine:
1. is_anomaly: true/false
2. confidence: 0.0-1.0
3. affected_services: list of services showing anomalous behavior
4. anomaly_type: "latency_spike" | "error_rate_increase" | "throughput_drop" | "none"
5. severity: "low" | "medium" | "high" | "critical"
6. recommendation: "continue" | "pause_canary" | "investigate" | "rollback"

Rules:
- Don't fire on transient spikes under 2 minutes old
- Error rate increases >5x baseline are always critical
- p99 increases >100% sustained for >2 minutes are high severity
- Weight recent ticks more than older ones
```

**Output:**
```json
{
  "is_anomaly": true,
  "confidence": 0.91,
  "affected_services": ["payment-service"],
  "anomaly_type": "latency_spike",
  "severity": "high",
  "recommendation": "investigate",
  "reasoning": "payment-service p99 has increased 88% from 180ms to 340ms over the last 4 minutes. This exceeds the 2-minute sustained threshold. Error rate is also rising (1.8% vs 0.12% baseline). Pattern is consistent with a slow DB query introduced in this deploy."
}
```

---

### S8 — `pause_canary`

**Purpose:** Send a signal to the CI/CD system to halt the canary rollout at its current traffic split percentage.

**Trigger:** Called when S7 returns `recommendation: "pause_canary"` or `"rollback"`.

**Inputs:**
```json
{
  "deployment_id": "string",
  "reason": "string",
  "current_canary_percentage": 10
}
```

**Implementation:**
- **GitHub Actions:** Dispatch a `workflow_dispatch` event to a `pause-canary.yml` workflow with the deployment ID.
- **ArgoCD:** `PATCH /api/v1/applications/{app}/spec` to set `strategy.canary.pause: true`.
- **Harness:** Call Harness pipeline API to pause stage.

The skill is CI/CD-system agnostic via an adapter pattern. A `cicd_adapter` config in `guardian.config.json` sets which backend to call.

**Output:**
```json
{
  "paused": true,
  "canary_frozen_at_pct": 10,
  "timestamp": "2024-01-15T14:37:00Z"
}
```

---

### S9 — `fetch_failing_traces`

**Purpose:** When an anomaly is confirmed, pull distributed traces for failing requests to identify where in the call chain errors are originating.

**Trigger:** Called when S7 returns `is_anomaly: true`.

**Inputs:**
```json
{
  "service_id": "string",
  "time_range": { "from": "ISO8601", "to": "ISO8601" },
  "error_filter": true,
  "limit": 50
}
```

**Dynatrace MCP Calls:**
```
GET /api/v2/traces?entitySelector=entityId({service_id})&from={from}&to={to}&errorType=FAILED_REQUEST&limit=50
```

**Output:**
```json
{
  "total_failing_requests": 312,
  "sample_traces": [
    {
      "trace_id": "abc123",
      "root_service": "payment-service",
      "error_service": "payment-service",
      "error_message": "DB connection timeout after 5000ms",
      "call_chain": ["api-gateway", "payment-service", "postgres-db"],
      "duration_ms": 5240,
      "error_code": "ECONNRESET"
    }
  ],
  "error_pattern": "DB connection timeout after 5000ms",
  "error_concentrated_in": "payment-service"
}
```

---

### S10 — `identify_root_cause`

**Purpose:** Synthesize trace data, metric deltas, and the deployment diff to produce a root cause analysis. This is the core multi-step reasoning skill.

**Trigger:** Called after S9 fetches traces.

**Inputs:**
```json
{
  "traces": "object",           // from S9
  "metric_deltas": "object",    // from S6/S7
  "deployment_diff": "object",  // from S2
  "risk_profile": "object"      // from S3
}
```

**Gemini Prompt (multi-step chain):**

Step 1 — Trace Analysis:
```
Given these distributed traces showing failures, identify: which service is the origin of errors (not just where they propagate), the error type, and whether the error pattern is consistent with the code changes in the diff.
```

Step 2 — Diff Correlation:
```
Given the root error service and error type from Step 1, examine the deployment diff. Is there a specific file or change that would explain this error? Quote the relevant change.
```

Step 3 — Verdict:
```
Produce a final root cause analysis with: root_service, root_cause_description, implicated_change (file + line if possible), confidence, and recommended_action.
```

**Output:**
```json
{
  "root_service": "payment-service",
  "root_cause_description": "The DB migration in migrate_v3.sql added a composite index on the transactions table without specifying CONCURRENTLY. During the migration, the table is locked, causing all DB queries from payment-service to time out. This is reflected in the 'DB connection timeout after 5000ms' error seen in 312 failing traces.",
  "implicated_change": "src/payment/db/migrate_v3.sql — line 14: CREATE INDEX idx_txn_user ON transactions(user_id, created_at)",
  "confidence": 0.94,
  "recommended_action": "rollback"
}
```

---

### S11 — `check_rollback_safety`

**Purpose:** Before executing a rollback, verify that it's safe to do so. Specifically checks for irreversible DB migrations.

**Trigger:** Called when S10 recommends rollback.

**Inputs:**
```json
{
  "deployment_diff": "object",     // from S2
  "root_cause": "object",          // from S10
  "migration_registry": "string"   // path or API endpoint for migration registry
}
```

**Implementation:**
1. Check if `changed_file_categories.db_migration` is true in the diff analysis.
2. Query the migration registry (a simple table or config file teams maintain) for whether the migration has a corresponding `down` migration.
3. Query Dynatrace to estimate data written since migration ran: `builtin:service.requestCount.rate` since deploy time to estimate how many rows were affected.
4. Gemini makes the final safety assessment.

**Output:**
```json
{
  "rollback_safe": false,
  "reason": "The DB migration in migrate_v3.sql (CREATE INDEX) is safe to roll back — index creation is reversible with DROP INDEX. However, if a column was added in the same migration, confirm no data has been written to that column. Estimated 4,200 requests processed since deploy.",
  "requires_manual_approval": true,
  "safe_operations": ["index_drop"],
  "risky_operations": []
}
```

---

### S12 — `execute_rollback`

**Purpose:** Trigger a rollback of the deployment in the CI/CD system, optionally with a DB migration reversal.

**Trigger:** Called when S11 confirms rollback is safe (or manual approval is given).

**Inputs:**
```json
{
  "deployment_id": "string",
  "rollback_to_sha": "string",
  "include_db_rollback": false,
  "reason": "string"
}
```

**Implementation:**
- Dispatches a `rollback.yml` GitHub Actions workflow via `workflow_dispatch` with `deployment_id` and `rollback_to_sha` as inputs.
- The `rollback.yml` is a standard workflow teams add to their repo (Guardian provides a template).
- If `include_db_rollback: true`, the workflow also runs `migrate down`.

**Output:**
```json
{
  "rollback_initiated": true,
  "rollback_run_id": "GH-RUN-99887766",
  "estimated_completion_sec": 120,
  "rollback_url": "https://github.com/org/payment-service/actions/runs/99887766"
}
```

---

### S13 — `write_flight_recorder_entry`

**Purpose:** Persist a complete, structured forensic record of the deployment — what happened, why, what the agent did, and what the outcome was.

**Trigger:** Called at the end of every deployment, regardless of outcome (approved, rolled back, or paused).

**Inputs:** All outputs from S1 through S12 that were invoked during the deployment.

**Storage:** PostgreSQL table `deployment_records` or a Firestore collection.

**Schema:**
```json
{
  "id": "uuid",
  "timestamp": "ISO8601",
  "repo": "string",
  "service": "string",
  "commit_sha": "string",
  "commit_message": "string",
  "outcome": "approved | rolled_back | paused | blocked_by_policy",
  "risk_score": "low | medium | high | critical",
  "blast_radius": "object",
  "baseline_metrics": "object",
  "anomaly_detected": "boolean",
  "root_cause_analysis": "object | null",
  "rollback_executed": "boolean",
  "agent_reasoning_chain": ["array of reasoning steps with timestamps"],
  "policy_evaluation": "object",
  "deploy_duration_minutes": "number",
  "post_deploy_steady_state_confirmed_at": "ISO8601 | null"
}
```

**Output:** Confirmation of write with record ID for linking in GitHub PR comments and Slack notifications.

---

### S14 — `detect_cross_deploy_regression`

**Purpose:** Periodically scan recent metric trends to find regressions that can't be explained by any single current deployment — indicating a delayed effect from an older deploy.

**Trigger:** Runs on a scheduled cron (every 4 hours) and on-demand when an unexplained metric degradation is detected.

**Inputs:**
```json
{
  "lookback_window": "7d",
  "degradation_threshold_pct": 15
}
```

**Implementation:**
1. Query Dynatrace for metric trends across all monitored services over the lookback window.
2. Identify services with sustained metric degradation but no recent deployment.
3. Query the Flight Recorder DB for all deployments in the blast radius of those services over the lookback window.
4. Use Gemini to correlate the degradation timeline with historical deployment timelines.

**Output:**
```json
{
  "regressions_found": 1,
  "regressions": [
    {
      "affected_service": "order-service",
      "metric": "p99_latency",
      "degradation_pct": 22,
      "degradation_started": "2024-01-12T09:00:00Z",
      "probable_cause_deployment": {
        "service": "payment-service",
        "commit_sha": "abc789",
        "deployed_at": "2024-01-12T08:45:00Z",
        "confidence": 0.87,
        "reasoning": "order-service p99 increased 22% starting at 09:00. payment-service v2.3.1 was deployed at 08:45 and changed the response shape of the /payment/status endpoint that order-service polls."
      }
    }
  ]
}
```

---

### S15 — `profile_developer_risk`

**Purpose:** Maintain and return a per-service, per-change-category risk profile learned from historical incident and deployment data.

**Trigger:** Called during S3 (blast radius scoring) and updated after every Flight Recorder entry.

**Inputs:**
```json
{
  "service_id": "string",
  "change_categories": ["db_migration", "api_contract_change", "config_change", "business_logic"]
}
```

**Implementation:**
- Reads from the `deployment_records` table in the Flight Recorder DB.
- Computes: for this service + change_category combination, what % of past deployments resulted in anomalies or rollbacks?
- Gemini summarizes the pattern in plain English for inclusion in the risk score reasoning.

**Output:**
```json
{
  "risk_profiles": {
    "payment-service": {
      "db_migration": {
        "incident_rate": 0.60,
        "historical_summary": "DB migrations on payment-service have triggered incidents 3 out of 5 times. Two caused table locks, one caused index bloat.",
        "sample_incidents": ["2023-10-04 — index lock", "2023-12-01 — schema timeout"]
      },
      "config_change": {
        "incident_rate": 0.00,
        "historical_summary": "No incidents from config changes on payment-service in 12 deployments."
      }
    }
  }
}
```

---

## Skill Composition by Phase

```
PRE-DEPLOY
  S1 fetch_service_topology
  S2 map_diff_to_services
  S15 profile_developer_risk        ← runs in parallel with S1/S2
  S3 score_blast_radius             ← depends on S1, S2, S15
  S5 evaluate_natural_language_policy
    → if BLOCK: S13 write_flight_recorder_entry (outcome: blocked_by_policy), STOP
  S4 snapshot_baseline_metrics

DURING DEPLOY (loop every 60s)
  S6 monitor_live_telemetry
  S7 detect_anomaly
    → if anomaly: S8 pause_canary

POST-DEPLOY / INVESTIGATION (triggered by anomaly or completion)
  S9 fetch_failing_traces
  S10 identify_root_cause
  S11 check_rollback_safety
    → if safe: S12 execute_rollback
    → if unsafe: alert + require human approval
  S13 write_flight_recorder_entry

CONTINUOUS (scheduled)
  S14 detect_cross_deploy_regression
  S15 profile_developer_risk        ← updates after every S13 write
```

---

## Skill Configuration — `guardian.config.json`

Each project adds this file to their repo root:

```json
{
  "dynatrace": {
    "environment_id": "abc12345",
    "mcp_server_url": "https://abc12345.live.dynatrace.com",
    "api_token_secret": "DYNATRACE_API_TOKEN"
  },
  "cicd_adapter": "github_actions",
  "service_map": "./service-map.json",
  "migration_registry": "./db/migrations/registry.json",
  "policies": [
    "Don't deploy to production if error rate on checkout exceeded 2% in the last hour",
    "Block deploys on Fridays after 3 PM unless approved by on-call",
    "Allow canary to proceed only if p99 latency stays under 500ms for 10 minutes"
  ],
  "canary": {
    "initial_pct": 5,
    "step_pct": 20,
    "step_interval_minutes": 10,
    "auto_rollback_on_critical": true,
    "require_human_approval_on_high": true
  },
  "notifications": {
    "slack_webhook_secret": "SLACK_WEBHOOK_URL",
    "github_pr_comments": true
  }
}
```
