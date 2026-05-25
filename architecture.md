# AI Deployment Guardian — Architecture Diagrams

---

## 1. System Architecture Overview

```mermaid
graph TB
    subgraph Triggers["🔔 Trigger Sources"]
        GH["GitHub Actions\nWebhook"]
        ARGO["ArgoCD\nResource Hook"]
        CRON["Scheduled\nCron Scanner"]
    end

    subgraph Guardian["🧠 AI Guardian Backend (Cloud Run)"]
        direction TB
        API["API Layer\n/api/v1/deployments"]
        SM["Session State Manager\nDeploymentSession FSM"]

        subgraph Loop["Reasoning Loop (Gemini 2.5 Pro)"]
            RL["ReAct Loop\nReason → Act → Observe"]
            CP["Context Compressor\n(sliding window)"]
        end

        subgraph Skills["Skill Executor (15 Skills)"]
            PRE["Pre-Deploy Skills\nS1 S2 S3 S4 S5"]
            LIVE["Live Monitor Skills\nS6 S7 S8"]
            POST["Post-Deploy Skills\nS9 S10 S11 S12"]
            BG["Background Skills\nS13 S14 S15"]
        end

        NB["Notification Bus\nSlack · GitHub PR"]
    end

    subgraph Data["📦 Data Layer"]
        PG[("PostgreSQL\nFlight Recorder\nRisk Profiles")]
    end

    subgraph Integrations["🔌 Integrations"]
        DT["Dynatrace MCP Server\nTraces · Metrics · Logs\nTopology"]
        GHAPI["GitHub API\nDiff · Workflow Dispatch"]
        CICD["CI/CD Adapter\nGitHub Actions · ArgoCD"]
    end

    subgraph Frontend["🖥️ React Dashboard"]
        LIVE_UI["Live Deploy View\nReal-time metrics"]
        FR_UI["Flight Recorder\nForensic timeline"]
        POL_UI["Policy Editor\nNatural language rules"]
        RISK_UI["Risk Profiles\nHistorical charts"]
    end

    GH -->|POST /api/v1/deployments| API
    ARGO -->|POST /api/v1/deployments| API
    CRON -->|POST /api/v1/scans| API

    API --> SM
    SM --> Loop
    Loop --> Skills
    Skills -->|MCP calls| DT
    Skills -->|REST| GHAPI
    Skills -->|workflow_dispatch| CICD
    Skills --> PG
    Loop --> NB
    NB -->|webhook| Frontend
    NB -->|PR comment| GHAPI

    Frontend -->|SSE / REST| API
    PG -->|query| Frontend
```

---

## 2. Deployment Lifecycle — State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE --> PRE_DEPLOY_ANALYSIS : webhook received

    PRE_DEPLOY_ANALYSIS --> RISK_SCORED : S1 + S2 + S15 complete

    RISK_SCORED --> BLOCKED_BY_POLICY : policy returns BLOCK
    RISK_SCORED --> BASELINE_CAPTURED : policy returns PASS

    BLOCKED_BY_POLICY --> IDLE : S13 flight record written

    BASELINE_CAPTURED --> MONITORING_LIVE : CI/CD deploy starts

    MONITORING_LIVE --> MONITORING_LIVE : anomaly confidence < 0.75
    MONITORING_LIVE --> INVESTIGATING : anomaly confidence ≥ 0.75
    MONITORING_LIVE --> APPROVED : deploy complete, no anomaly

    INVESTIGATING --> ROLLING_BACK : rollback safe + confidence ≥ 0.85
    INVESTIGATING --> AWAITING_HUMAN : rollback unsafe OR confidence < 0.85

    AWAITING_HUMAN --> ROLLING_BACK : human approves rollback
    AWAITING_HUMAN --> APPROVED : human approves deploy

    ROLLING_BACK --> ROLLED_BACK : rollback complete

    ROLLED_BACK --> IDLE : S13 written
    APPROVED --> STEADY_STATE_CONFIRMED : post-deploy metrics stable
    STEADY_STATE_CONFIRMED --> IDLE : S13 written
```

---

## 3. Pre-Deploy Phase — Skill Orchestration

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant GHA as GitHub Actions
    participant API as Guardian API
    participant Agent as Gemini Agent
    participant DT as Dynatrace MCP
    participant GHAPI as GitHub API
    participant FR as Flight Recorder

    Dev->>GHA: git push → deploy workflow
    GHA->>API: POST /deployments {commit_sha, service}
    API->>Agent: Start DeploymentSession

    par Parallel fetch
        Agent->>DT: S1: fetch_service_topology(payment-service)
        DT-->>Agent: dependency graph (4 services)
    and
        Agent->>GHAPI: S2: map_diff_to_services(commit_sha)
        GHAPI-->>Agent: changed files + categories
    and
        Agent->>FR: S15: profile_developer_risk(payment-service)
        FR-->>Agent: "DB migrations: 3/5 incident rate"
    end

    Agent->>Agent: S3: score_blast_radius(topology + diff + history)
    Note over Agent: Gemini reasons: HIGH risk\n4 downstream services\nDB migration history

    Agent->>DT: S5: evaluate_natural_language_policy(policies)
    DT-->>Agent: current metrics for policy checks
    Agent->>Agent: Gemini evaluates each policy

    alt Policy BLOCKS deploy
        Agent->>GHA: Block deployment
        Agent->>FR: S13: write_flight_recorder_entry(outcome: blocked)
        Agent->>Dev: PR comment: "Blocked — error rate 3.4% > 2% threshold"
    else Policy PASSES
        Agent->>DT: S4: snapshot_baseline_metrics(all blast-radius services)
        DT-->>Agent: p50/p99/error_rate/rps baselines
        Agent->>GHA: Proceed with canary at 5%
        Agent->>Dev: PR comment: "HIGH risk — canary started, Guardian watching"
    end
```

---

## 4. Live Monitoring Phase — Anomaly Detection Loop

```mermaid
sequenceDiagram
    participant GHA as CI/CD (Canary)
    participant Agent as Gemini Agent
    participant DT as Dynatrace MCP
    participant FR as Flight Recorder
    participant Dev as On-Call Engineer

    GHA->>Agent: canary_started(deployment_id, initial_pct=5)

    loop Every 60 seconds
        Agent->>DT: S6: monitor_live_telemetry(blast_radius_services)
        DT-->>Agent: current p50/p99/error_rate + deltas from baseline

        Agent->>Agent: S7: detect_anomaly(current_metrics, baseline, variance)
        Note over Agent: Gemini evaluates: real regression or noise?

        alt No anomaly (confidence < 0.75)
            Agent->>Agent: Continue monitoring
            Note over Agent: Log tick to reasoning chain
        else Anomaly detected (severity=high, confidence≥0.85)
            Agent->>GHA: S8: pause_canary(deployment_id)
            GHA-->>Agent: canary frozen at 5%
            Agent->>Dev: Slack: "Canary paused — p99 +88%, investigating"
            break Exit monitoring loop
            end
        end
    end
```

---

## 5. Post-Deploy Investigation & Rollback

```mermaid
sequenceDiagram
    participant Agent as Gemini Agent
    participant DT as Dynatrace MCP
    participant GHAPI as GitHub API
    participant GHA as GitHub Actions
    participant FR as Flight Recorder
    participant Dev as On-Call Engineer

    Note over Agent: Anomaly confirmed — entering investigation

    Agent->>DT: S9: fetch_failing_traces(payment-service, last 5min)
    DT-->>Agent: 312 failing traces\n"DB connection timeout 5000ms"

    Agent->>Agent: S10: identify_root_cause(traces + diff + metrics)
    Note over Agent: Step 1: Trace origin → payment-service DB call\nStep 2: Diff correlation → migrate_v3.sql line 14\nStep 3: Verdict: 94% confidence — index lock

    Agent->>FR: S11: check_rollback_safety(diff_analysis)
    FR-->>Agent: "CREATE INDEX is reversible — safe to rollback"

    alt Rollback safe + auto_rollback enabled
        Agent->>GHA: S12: execute_rollback(rollback_to_sha=base_sha)
        GHA-->>Agent: rollback_run_id, estimated 120s
        Agent->>Dev: Slack: "Auto-rolled back — root cause: DB migration\ntable lock on transactions. See flight recorder."
        Agent->>GHAPI: PR comment with full RCA
    else Rollback unsafe OR requires approval
        Agent->>Dev: Slack + PagerDuty: "Human approval needed — DB migration\nmay have written data. Rollback risky."
        Dev-->>Agent: approve_rollback()
        Agent->>GHA: S12: execute_rollback(include_db_rollback=true)
    end

    Agent->>FR: S13: write_flight_recorder_entry(full session)
    Note over FR: Forensic record: diff · baseline · anomaly\nRCA · rollback · reasoning chain
```

---

## 6. Skill Dependency Graph

```mermaid
graph LR
    subgraph PRE["Pre-Deploy"]
        S1["S1\nfetch_topology"]
        S2["S2\nmap_diff"]
        S15["S15\nrisk_profile"]
        S3["S3\nscore_blast_radius"]
        S5["S5\npolicy_check"]
        S4["S4\nbaseline_snapshot"]
    end

    subgraph LIVE["During Deploy"]
        S6["S6\nlive_telemetry"]
        S7["S7\ndetect_anomaly"]
        S8["S8\npause_canary"]
    end

    subgraph POST["Post-Deploy"]
        S9["S9\nfailing_traces"]
        S10["S10\nroot_cause"]
        S11["S11\nrollback_safety"]
        S12["S12\nexecute_rollback"]
        S13["S13\nflight_recorder"]
    end

    subgraph BG["Background"]
        S14["S14\ncross_deploy_scan"]
    end

    S1 --> S3
    S2 --> S3
    S15 --> S3
    S3 --> S5
    S5 -->|pass| S4
    S4 --> S6

    S6 --> S7
    S7 -->|anomaly| S8
    S7 -->|anomaly| S9

    S9 --> S10
    S10 --> S11
    S11 -->|safe| S12
    S12 --> S13
    S10 --> S13
    S5 -->|block| S13

    S13 --> S15
    S13 --> S14

    style S3 fill:#ff9900,color:#000
    style S7 fill:#ff9900,color:#000
    style S10 fill:#ff4444,color:#fff
    style S12 fill:#ff4444,color:#fff
```

---

## 7. Data Flow — Dynatrace MCP Integration

```mermaid
graph LR
    subgraph Agent["Guardian Agent"]
        SK["Skill Executor"]
        MCP_A["MCP Adapter\n(Python client)"]
    end

    subgraph MCP["Dynatrace MCP Server"]
        TOPO["Topology\nentity graph"]
        METRICS["Metrics API\nbuiltin selectors"]
        TRACES["Distributed\nTracing API"]
        LOGS["Log\nIngestion API"]
    end

    subgraph DT_BACK["Dynatrace Backend"]
        OTEL["OpenTelemetry\nPipeline"]
        AI_OPS["Davis AI\nAnomaly Detection"]
        SMART["Smartscape\nTopology Engine"]
    end

    SK -->|skill call| MCP_A
    MCP_A -->|MCP tool call| TOPO
    MCP_A -->|MCP tool call| METRICS
    MCP_A -->|MCP tool call| TRACES
    MCP_A -->|MCP tool call| LOGS

    TOPO --> SMART
    METRICS --> OTEL
    TRACES --> OTEL
    LOGS --> OTEL
    OTEL --> AI_OPS

    style MCP fill:#1a73e8,color:#fff
    style DT_BACK fill:#00b4e6,color:#fff
```

---

## 8. Frontend Dashboard Layout

```mermaid
graph TD
    subgraph App["React Dashboard"]
        NAV["Top Nav: Active Deploys 🔴3 | Records | Policies | Risk"]

        subgraph Live["Live Deploy View /deployments/:id"]
            HEADER["payment-service v2.3.1 · HIGH RISK · INVESTIGATING 🔴"]
            
            subgraph Tabs["Tabs"]
                T1["Risk Assessment\nBlast radius force graph\n4 services · HIGH"]
                T2["Live Metrics\nReal-time chart overlay\np99: 340ms vs 180ms baseline"]
                T3["Investigation\nRoot cause card\n94% confidence · RCA text"]
                T4["Reasoning Chain\nStep-by-step agent log\nwith timestamps"]
            end

            ACTIONS["[ Approve Deploy ]  [ Force Rollback ]  [ Notify On-Call ]"]
        end

        subgraph Records["Flight Recorder /records"]
            TABLE["Deployment table\nService · Risk · Outcome · Date"]
            FILTER["Filter: outcome · service · date range"]
        end

        subgraph Policy["Policy Editor /policies"]
            EDITOR["Natural language textarea\nper-team policy list"]
            PREVIEW["Live preview: parsed policy\ncheck → metric → threshold"]
        end
    end
```
