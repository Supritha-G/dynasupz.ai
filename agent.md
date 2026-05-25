# AI Deployment Guardian — Agent Architecture

This document specifies the agent's reasoning loop, state machine, prompt design, tool orchestration, and all runtime behavior. Read `skills.md` first for the individual skill specifications that this document orchestrates.

---

## Agent Identity

**Model:** Gemini 2.5 Pro (via Google Cloud Vertex AI Agent Builder)
**Role:** Senior SRE with read/write access to production observability data and CI/CD systems
**Decision authority:** Can auto-approve, auto-pause, and auto-rollback within configured thresholds. Escalates to humans when confidence < 0.75 or when rollback safety is uncertain.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT RUNTIME                               │
│                                                                 │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │  Trigger     │───▶│  Reasoning Loop  │───▶│  Action      │  │
│  │  Handler     │    │  (Gemini LLM)    │    │  Dispatcher  │  │
│  └──────────────┘    └──────────────────┘    └──────────────┘  │
│         │                    │                       │          │
│         ▼                    ▼                       ▼          │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │  State       │    │  Skill           │    │  Notification│  │
│  │  Manager     │    │  Executor        │    │  Bus         │  │
│  └──────────────┘    └──────────────────┘    └──────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
         │                    │                       │
         ▼                    ▼                       ▼
  ┌─────────────┐    ┌────────────────┐    ┌─────────────────┐
  │  Flight     │    │  Dynatrace MCP │    │  GitHub Actions │
  │  Recorder   │    │  Server        │    │  / ArgoCD       │
  │  (Postgres) │    └────────────────┘    └─────────────────┘
  └─────────────┘
```

---

## Deployment Lifecycle State Machine

The agent manages a `DeploymentSession` object that transitions through these states:

```
IDLE
  │
  ├─[webhook received]──▶ PRE_DEPLOY_ANALYSIS
  │                              │
  │                    [S1 + S2 + S15 complete]
  │                              │
  │                              ▼
  │                       RISK_SCORED
  │                              │
  │             ┌────────────────┴───────────────────┐
  │      [policy BLOCK]                      [policy PASS]
  │             │                                    │
  │             ▼                                    ▼
  │       BLOCKED_BY_POLICY                   BASELINE_CAPTURED
  │             │                                    │
  │      [S13 write]                    [deploy begins in CI/CD]
  │             │                                    │
  │             ▼                                    ▼
  │           IDLE                           MONITORING_LIVE
  │                                                  │
  │                              ┌───────────────────┤
  │                      [anomaly detected]   [no anomaly, deploy complete]
  │                              │                   │
  │                              ▼                   ▼
  │                       INVESTIGATING         APPROVED
  │                              │                   │
  │                   ┌──────────┴────────┐          │
  │           [rollback safe]    [unsafe / human]    │
  │                   │                   │          │
  │                   ▼                   ▼          │
  │             ROLLING_BACK      AWAITING_HUMAN     │
  │                   │                   │          │
  │                   ▼                   ▼          ▼
  │              ROLLED_BACK      [human decision]  STEADY_STATE_CONFIRMED
  │                   │                             │
  └────────[S13 write]──────────────────────────────┘
                       │
                       ▼
                     IDLE
```

### State Object Shape

```typescript
interface DeploymentSession {
  id: string;                          // UUID
  state: DeploymentState;
  repo: string;
  service: string;
  commit_sha: string;
  base_sha: string;
  deployment_id: string;               // CI/CD system deployment ID
  started_at: string;                  // ISO8601
  
  // Populated progressively as skills run
  topology?: TopologyResult;
  diff_analysis?: DiffAnalysisResult;
  risk_profile?: RiskProfileResult;
  blast_radius?: BlastRadiusResult;
  policy_evaluation?: PolicyEvalResult;
  baseline_metrics?: BaselineSnapshot;
  
  // Live monitoring state
  telemetry_ticks: TelemetryTick[];
  anomaly_detected: boolean;
  anomaly_result?: AnomalyResult;
  
  // Investigation state
  traces?: TraceResult;
  root_cause?: RootCauseResult;
  rollback_safety?: RollbackSafetyResult;
  rollback_result?: RollbackResult;
  
  // Reasoning chain — append-only log
  reasoning_chain: ReasoningStep[];
}

interface ReasoningStep {
  timestamp: string;
  skill: string;
  input_summary: string;
  output_summary: string;
  decision?: string;
  confidence?: number;
}
```

---

## Agent System Prompt

This prompt is loaded once per `DeploymentSession` and persists across all skill calls in that session.

```
You are the AI Deployment Guardian, an autonomous SRE agent responsible for protecting production deployments.

Your operating principles:
1. Safety over speed. When uncertain, pause and escalate rather than proceed.
2. Evidence-based decisions. Every decision must cite specific metrics, traces, or historical data.
3. Conservative thresholds. Error rate increases >3x baseline or p99 increases >80% for >2 minutes are always actionable.
4. Explainability. Every action you take must be logged in plain English in the reasoning chain.
5. Rollback is a success, not a failure. A rolled-back deploy that prevented an outage is better than an approved deploy that caused one.

You have access to these tools:
- fetch_service_topology: Get the live service dependency graph from Dynatrace
- map_diff_to_services: Analyze which services a code change affects
- score_blast_radius: Compute risk score and impact map
- snapshot_baseline_metrics: Capture pre-deploy metric baselines
- evaluate_natural_language_policy: Check team-defined deployment policies
- monitor_live_telemetry: Poll live Dynatrace metrics during deploy
- detect_anomaly: Determine if a metric deviation is a real regression
- pause_canary: Halt canary rollout at current traffic split
- fetch_failing_traces: Get distributed traces for failing requests
- identify_root_cause: Synthesize traces + diff to find root cause
- check_rollback_safety: Determine if rollback is safe given DB migrations
- execute_rollback: Trigger rollback in CI/CD system
- write_flight_recorder_entry: Persist forensic deployment record
- detect_cross_deploy_regression: Find regressions spanning multiple deploys
- profile_developer_risk: Get historical risk data for service+change type

Current deployment context:
{DEPLOYMENT_CONTEXT}

Always think step by step. Explain your reasoning before calling each tool.
```

---

## Reasoning Loop Implementation

The agent uses a **tool-call loop** pattern (ReAct style: Reason → Act → Observe → Repeat).

```python
async def run_deployment_session(session: DeploymentSession, config: GuardianConfig):
    messages = [
        {"role": "system", "content": build_system_prompt(session, config)},
        {"role": "user", "content": build_initial_trigger_message(session)}
    ]
    
    while session.state not in TERMINAL_STATES:
        response = await gemini_client.generate_content(
            model="gemini-2.5-pro",
            contents=messages,
            tools=SKILL_TOOL_DEFINITIONS,
            tool_config={"function_calling_config": {"mode": "AUTO"}}
        )
        
        # Append assistant turn
        messages.append({"role": "model", "content": response.candidates[0].content})
        
        # Process tool calls
        if response.candidates[0].content.parts:
            tool_results = []
            for part in response.candidates[0].content.parts:
                if part.function_call:
                    result = await execute_skill(
                        skill_name=part.function_call.name,
                        args=dict(part.function_call.args),
                        session=session
                    )
                    tool_results.append({
                        "function_response": {
                            "name": part.function_call.name,
                            "response": result
                        }
                    })
                    # Append to reasoning chain
                    session.reasoning_chain.append(ReasoningStep(
                        timestamp=now_iso(),
                        skill=part.function_call.name,
                        input_summary=summarize(dict(part.function_call.args)),
                        output_summary=summarize(result)
                    ))
            
            if tool_results:
                messages.append({"role": "user", "content": tool_results})
        
        # Check if agent has reached a terminal decision
        update_session_state(session, response)
        
        # State-specific guards
        if session.state == DeploymentState.MONITORING_LIVE:
            await asyncio.sleep(60)  # Poll interval
        
        if len(messages) > 80:  # Context limit guard
            messages = compress_context(messages, session)
    
    # Always write flight recorder at end
    await execute_skill("write_flight_recorder_entry", {"session": session}, session)
```

---

## Trigger Handler

The agent is triggered by three sources:

### 1. GitHub Actions Webhook

Add this step to any GitHub Actions deployment workflow:

```yaml
# .github/workflows/deploy.yml
- name: Notify AI Guardian
  uses: org/ai-guardian-action@v1
  with:
    event: pre_deploy
    service: payment-service
    commit_sha: ${{ github.sha }}
    base_sha: ${{ github.event.before }}
    deployment_id: ${{ steps.deploy.outputs.deployment_id }}
    guardian_url: ${{ secrets.GUARDIAN_URL }}
    guardian_token: ${{ secrets.GUARDIAN_TOKEN }}
```

The GitHub Action calls the Guardian backend:
```
POST /api/v1/deployments
{
  "event": "pre_deploy",
  "repo": "org/payment-service",
  "service": "payment-service",
  "commit_sha": "abc123",
  "base_sha": "def456",
  "deployment_id": "deploy-789"
}
```

### 2. ArgoCD Webhook (Resource Hook)

```yaml
# argocd-application.yaml
metadata:
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: HookSucceeded
spec:
  source:
    plugin:
      name: guardian-presync
```

### 3. Scheduled Cross-Deploy Scan

```
Cron: 0 */4 * * *   →   POST /api/v1/scans/cross-deploy
```

---

## Initial Trigger Message

When a `pre_deploy` event arrives, the agent receives this as the first user message:

```
A new deployment has been triggered. Here is the context:

Repo: org/payment-service
Service: payment-service  
Commit: abc123def456
Base commit: 789ghi012
Deployment ID: deploy-789
Commit message: "feat(payment): add composite index on transactions table for faster user lookups"
Triggered by: supritha@company.com
Timestamp: 2024-01-15T14:30:00Z

Please begin your pre-deploy analysis. Start by fetching the service topology and analyzing the diff in parallel.
```

---

## Tool Definitions for Gemini Function Calling

All 15 skills are registered as Gemini function declarations. Example for `score_blast_radius`:

```python
SKILL_TOOL_DEFINITIONS = [
    {
        "function_declarations": [
            {
                "name": "score_blast_radius",
                "description": "Compute a risk score and downstream impact map for a deployment based on service topology, code diff analysis, and historical incident patterns.",
                "parameters": {
                    "type": "OBJECT",
                    "properties": {
                        "topology": {
                            "type": "OBJECT",
                            "description": "Service topology from fetch_service_topology"
                        },
                        "diff_analysis": {
                            "type": "OBJECT",
                            "description": "Diff analysis from map_diff_to_services"
                        },
                        "historical_incidents": {
                            "type": "ARRAY",
                            "description": "Historical risk profiles from profile_developer_risk"
                        }
                    },
                    "required": ["topology", "diff_analysis"]
                }
            },
            # ... 14 more skill declarations
        ]
    }
]
```

---

## Decision Thresholds and Escalation Matrix

| Condition | Auto Action | Human Escalation |
|-----------|-------------|------------------|
| Policy blocks deploy | Block immediately | Notify on-call via Slack |
| Risk score = critical | Block + require approval | Required before any deploy |
| Risk score = high | Canary only, 5% initial | Notify team |
| Risk score = medium | Standard canary | No notification |
| Risk score = low | Full rollout | No notification |
| Anomaly confidence ≥ 0.85 + severity = critical | Auto-rollback | Notify on-call immediately |
| Anomaly confidence ≥ 0.75 + severity = high | Pause canary, investigate | Notify team |
| Anomaly confidence < 0.75 | Continue monitoring | No notification |
| Rollback safe = false | Pause, do not rollback | Required human decision |
| Agent reasoning loop > 20 steps | Pause canary | Escalate: agent uncertainty |

---

## Context Compression Strategy

Long-lived monitoring sessions can exhaust the Gemini context window. The agent uses a sliding compression approach:

```python
def compress_context(messages: list, session: DeploymentSession) -> list:
    # Always keep:
    # - System prompt (index 0)
    # - First trigger message (index 1)
    # - Last 10 messages (most recent state)
    
    # Compress middle section into a structured summary injected as a system message
    middle = messages[2:-10]
    summary = {
        "role": "system",
        "content": f"""
        [COMPRESSED CONTEXT SUMMARY]
        Deployment session {session.id} is in state {session.state}.
        Key findings so far:
        - Risk score: {session.blast_radius.risk_score if session.blast_radius else 'pending'}
        - Baseline captured: {session.baseline_metrics is not None}
        - Anomaly detected: {session.anomaly_detected}
        - Root cause: {session.root_cause.root_cause_description if session.root_cause else 'none yet'}
        - Actions taken: {[s.skill for s in session.reasoning_chain]}
        Full reasoning chain available in flight recorder ID: {session.id}
        """
    }
    
    return [messages[0], messages[1], summary] + messages[-10:]
```

---

## Notification Bus

All significant agent decisions emit structured notifications:

```python
async def notify(event_type: str, session: DeploymentSession, payload: dict):
    notification = {
        "event": event_type,
        "deployment_id": session.deployment_id,
        "service": session.service,
        "timestamp": now_iso(),
        "payload": payload
    }
    
    # Slack
    await post_to_slack(format_slack_message(notification), config.slack_webhook)
    
    # GitHub PR comment
    if event_type in ["blast_radius_scored", "anomaly_detected", "rollback_executed", "approved"]:
        await post_github_pr_comment(format_pr_comment(notification), session.repo, session.commit_sha)
```

**GitHub PR Comment — Blast Radius Report:**
```markdown
## 🛡️ AI Deployment Guardian — Pre-Deploy Analysis

**Risk Score:** 🔴 HIGH  
**Affected Services:** 4 downstream services  

| Service | Predicted Impact |
|---------|----------------|
| order-service | 🟠 High |
| fraud-service | 🟡 Medium |
| notification-service | 🟢 Low |
| inventory-service | 🟢 Low |

**Risk Factors:**
- DB migration on high-traffic service
- 3 of 5 past DB migrations on payment-service caused incidents
- Deploying during peak traffic window (2:30 PM)

**Policy Check:** ✅ All policies passed  
**Canary:** Deploy will begin at 5% traffic. Guardian is watching.

_[View full flight recorder entry →](https://guardian.company.com/deployments/deploy-789)_
```

---

## Backend Service Structure

```
guardian/
├── api/
│   ├── routes/
│   │   ├── deployments.py       # POST /api/v1/deployments (webhook receiver)
│   │   ├── scans.py             # POST /api/v1/scans/cross-deploy
│   │   └── records.py           # GET /api/v1/records/{id} (flight recorder viewer)
│   └── middleware/
│       └── auth.py              # HMAC verification for GitHub webhooks
│
├── agent/
│   ├── session.py               # DeploymentSession state machine
│   ├── loop.py                  # Main reasoning loop
│   ├── prompts.py               # System prompt builder
│   ├── context.py               # Context compression
│   └── decisions.py             # Threshold evaluation + escalation matrix
│
├── skills/
│   ├── topology.py              # S1: fetch_service_topology
│   ├── diff.py                  # S2: map_diff_to_services
│   ├── blast_radius.py          # S3: score_blast_radius
│   ├── baseline.py              # S4: snapshot_baseline_metrics
│   ├── policy.py                # S5: evaluate_natural_language_policy
│   ├── monitor.py               # S6: monitor_live_telemetry
│   ├── anomaly.py               # S7: detect_anomaly
│   ├── canary.py                # S8: pause_canary
│   ├── traces.py                # S9: fetch_failing_traces
│   ├── root_cause.py            # S10: identify_root_cause
│   ├── rollback_safety.py       # S11: check_rollback_safety
│   ├── rollback.py              # S12: execute_rollback
│   ├── flight_recorder.py       # S13: write_flight_recorder_entry
│   ├── cross_deploy.py          # S14: detect_cross_deploy_regression
│   └── risk_profile.py          # S15: profile_developer_risk
│
├── integrations/
│   ├── dynatrace/
│   │   ├── client.py            # Dynatrace API wrapper
│   │   └── mcp_adapter.py       # MCP server calls → Python
│   ├── cicd/
│   │   ├── adapter.py           # Abstract base
│   │   ├── github_actions.py    # GitHub Actions implementation
│   │   └── argocd.py            # ArgoCD implementation
│   └── notifications/
│       ├── slack.py
│       └── github.py
│
├── db/
│   ├── models.py                # SQLAlchemy models for flight_recorder
│   └── migrations/              # Alembic migrations
│
└── config/
    ├── guardian.schema.json     # JSON schema for guardian.config.json
    └── loader.py                # Config loader + validator
```

---

## Database Schema

```sql
-- Flight Recorder
CREATE TABLE deployment_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    repo TEXT NOT NULL,
    service TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    deployment_id TEXT NOT NULL,
    commit_message TEXT,
    triggered_by TEXT,
    
    -- Outcome
    outcome TEXT NOT NULL CHECK (outcome IN ('approved', 'rolled_back', 'paused', 'blocked_by_policy')),
    deploy_started_at TIMESTAMPTZ,
    deploy_completed_at TIMESTAMPTZ,
    
    -- Risk Assessment
    risk_score TEXT CHECK (risk_score IN ('low', 'medium', 'high', 'critical')),
    blast_radius JSONB,
    
    -- Metrics
    baseline_metrics JSONB,
    peak_metrics JSONB,
    
    -- Investigation
    anomaly_detected BOOLEAN DEFAULT FALSE,
    anomaly_type TEXT,
    root_cause_analysis JSONB,
    rollback_executed BOOLEAN DEFAULT FALSE,
    
    -- Policy
    policy_evaluation JSONB,
    
    -- Agent reasoning
    reasoning_chain JSONB DEFAULT '[]',
    
    -- Post-deploy
    steady_state_confirmed_at TIMESTAMPTZ
);

CREATE INDEX idx_deployment_records_service ON deployment_records(service);
CREATE INDEX idx_deployment_records_commit ON deployment_records(commit_sha);
CREATE INDEX idx_deployment_records_outcome ON deployment_records(outcome);
CREATE INDEX idx_deployment_records_created_at ON deployment_records(created_at);

-- Risk Profile Cache (updated after each flight recorder write)
CREATE TABLE service_risk_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service TEXT NOT NULL,
    change_category TEXT NOT NULL,
    total_deploys INTEGER DEFAULT 0,
    incident_deploys INTEGER DEFAULT 0,
    incident_rate FLOAT DEFAULT 0.0,
    last_incident_at TIMESTAMPTZ,
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    incidents_summary JSONB DEFAULT '[]',
    
    UNIQUE(service, change_category)
);
```

---

## Gemini Client Configuration

```python
import vertexai
from vertexai.generative_models import GenerativeModel, GenerationConfig

vertexai.init(project="your-gcp-project", location="us-central1")

gemini_client = GenerativeModel(
    model_name="gemini-2.5-pro",
    generation_config=GenerationConfig(
        temperature=0.1,          # Low temp for deterministic SRE decisions
        top_p=0.8,
        max_output_tokens=8192,
        response_mime_type="application/json"  # For structured skill outputs
    ),
    system_instruction=GUARDIAN_SYSTEM_PROMPT
)
```

**Why temperature=0.1:** The agent makes consequential production decisions. Determinism and consistency matter more than creativity. Low temperature ensures repeated runs on the same input produce the same rollback/approve decision.

---

## Dynatrace MCP Integration

The Dynatrace MCP server exposes observability data as structured tools. The Guardian's `mcp_adapter.py` translates skill inputs to MCP calls:

```python
class DynatraceMCPAdapter:
    def __init__(self, mcp_server_url: str, api_token: str):
        self.base_url = mcp_server_url
        self.headers = {"Authorization": f"Api-Token {api_token}"}
    
    async def query_metrics(self, metric_selector: str, entity_selector: str, 
                             from_time: str, to_time: str) -> dict:
        response = await httpx.post(
            f"{self.base_url}/api/v2/metrics/query",
            headers=self.headers,
            json={
                "metricSelector": metric_selector,
                "entitySelector": entity_selector,
                "from": from_time,
                "to": to_time,
                "resolution": "1m"
            }
        )
        return response.json()
    
    async def get_topology(self, entity_id: str, depth: int = 3) -> dict:
        # Traverse the topology graph up to `depth` hops
        visited = {}
        queue = [(entity_id, 0)]
        while queue:
            current_id, current_depth = queue.pop(0)
            if current_depth >= depth or current_id in visited:
                continue
            entity = await self._get_entity(current_id)
            visited[current_id] = entity
            for relationship in entity.get("toRelationships", {}).get("calls", []):
                queue.append((relationship["id"], current_depth + 1))
        return visited
    
    async def get_traces(self, entity_id: str, from_time: str, 
                          to_time: str, error_only: bool = True) -> dict:
        return await httpx.get(
            f"{self.base_url}/api/v2/traces",
            headers=self.headers,
            params={
                "entitySelector": f"entityId({entity_id})",
                "from": from_time,
                "to": to_time,
                "errorType": "FAILED_REQUEST" if error_only else None,
                "limit": 50
            }
        ).json()
```

---

## Frontend Dashboard Routes

```
/                           → Active deployments list (live updating via SSE)
/deployments/:id            → Live deployment session view
  ├── Risk Assessment tab   → Blast radius map (D3 force graph of dependency topology)
  ├── Live Metrics tab       → Real-time charts (p50/p99/error rate vs baseline)
  ├── Investigation tab      → Root cause analysis (only shown when anomaly detected)
  └── Reasoning Chain tab    → Step-by-step agent thought log
/records                    → Flight recorder — all historical deployments
/records/:id                → Full forensic record for one deployment
/policies                   → Natural language policy editor (per team)
/risk-profiles              → Per-service historical risk charts
```

---

## Demo Scenario Execution Plan

For the hackathon demo, the agent runs against a pre-configured sandbox:

**Services:** `payment-service`, `order-service`, `fraud-service`, `notification-service`
**Dynatrace sandbox:** Live environment with injected fault scenarios
**Fault injection:** During canary, a chaos agent injects 2000ms latency on the payment-service DB connection pool

**Step-by-step walkthrough:**
1. Push commit to `payment-service` with a DB migration in the diff
2. Guardian webhook fires → blast radius analysis runs → outputs "HIGH" risk, 4 services affected
3. Policy check passes (no active policy blocking this)
4. Canary begins at 5% traffic
5. Chaos agent injects DB latency at T+2 minutes
6. Guardian's S6/S7 fires: detects p99 spike from 180ms → 2100ms, error rate 0.12% → 8.4%
7. S9 fetches traces: 847 failing requests, all timing out at DB call
8. S10 correlates with diff: identifies the migration as the cause
9. S11 confirms rollback safe (index creation is reversible)
10. S12 triggers rollback
11. S13 writes the full forensic record
12. GitHub PR gets comment: "Guardian rolled back deploy-789 — root cause: DB migration caused table lock under load"

---

## Environment Variables

```bash
# Required
GEMINI_PROJECT_ID=your-gcp-project
GEMINI_LOCATION=us-central1
DYNATRACE_ENV_ID=abc12345
DYNATRACE_API_TOKEN=dt0c01...
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/secrets/github-app.pem
DATABASE_URL=postgresql://user:pass@host/guardian

# Optional
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
GUARDIAN_PORT=8080
LOG_LEVEL=INFO
ARGOCD_URL=https://argocd.internal
ARGOCD_TOKEN=...
```

---

## Key Design Decisions

**Why Gemini for reasoning, not rule-based logic?**
Static rules ("roll back if error rate > 5%") can't distinguish a real regression from a traffic spike, a load test, or a one-time event. Gemini reasons about context: how long has the anomaly lasted, what does the trace say, does this match the diff, is this within normal variance? Rules can't do that.

**Why Dynatrace MCP instead of direct API calls?**
MCP provides a typed, self-describing interface that Gemini can call directly as a tool without custom adapter code for every metric type. The MCP server handles auth, rate limiting, and data normalization — the agent just asks for what it needs in plain terms.

**Why Flight Recorder as a first-class feature?**
Most post-incident retrospectives suffer from "we don't know what the system looked like right before and during the incident." The Flight Recorder eliminates that problem permanently. It also enables the Developer Risk Profile (S15) by providing training data from real deployments.

**Why natural language policies instead of YAML?**
DevOps best practices shouldn't require a DevOps engineer to express. A product manager can write "don't deploy on Fridays after 3 PM." The policy engine makes quality gates accessible to non-technical stakeholders and far more expressive than threshold-based YAML.
