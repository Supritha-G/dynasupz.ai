import { FunctionDeclaration, SchemaType } from '@google-cloud/vertexai';

export const SKILL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'fetch_service_topology',
    description: 'Get the live runtime service dependency graph from Dynatrace for the target service and all transitive dependents.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service_id: { type: SchemaType.STRING, description: 'Service name or Dynatrace entity ID' },
        depth: { type: SchemaType.INTEGER, description: 'Max dependency hops to traverse (default 3)' },
      },
      required: ['service_id'],
    },
  },
  {
    name: 'map_diff_to_services',
    description: 'Analyze the Git diff and determine which services are touched by the code changes.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        repo: { type: SchemaType.STRING },
        commit_sha: { type: SchemaType.STRING },
        base_sha: { type: SchemaType.STRING },
      },
      required: ['repo', 'commit_sha', 'base_sha'],
    },
  },
  {
    name: 'profile_developer_risk',
    description: 'Return historical incident rates for this service and change type from the Flight Recorder.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING },
        change_categories: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: 'e.g. ["db_migration", "api_contract_change"]',
        },
      },
      required: ['service'],
    },
  },
  {
    name: 'score_blast_radius',
    description: 'Compute a risk score (low/medium/high/critical) and downstream impact map using topology, diff, and historical data.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        topology: { type: SchemaType.OBJECT, description: 'Output from fetch_service_topology' },
        diff_analysis: { type: SchemaType.OBJECT, description: 'Output from map_diff_to_services' },
        historical_incidents: { type: SchemaType.OBJECT, description: 'Output from profile_developer_risk' },
      },
      required: ['topology', 'diff_analysis'],
    },
  },
  {
    name: 'evaluate_natural_language_policy',
    description: 'Parse team deployment policies and check current Dynatrace metrics against them. Returns pass or block.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        policies: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        service: { type: SchemaType.STRING },
        risk_score: { type: SchemaType.STRING },
      },
      required: ['policies', 'service'],
    },
  },
  {
    name: 'snapshot_baseline_metrics',
    description: 'Capture pre-deploy p50/p99/error_rate/rps baseline for all services in the blast radius.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        services: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        lookback_window: { type: SchemaType.STRING, description: 'e.g. "30m"' },
      },
      required: ['services'],
    },
  },
  {
    name: 'monitor_live_telemetry',
    description: 'Poll live Dynatrace metrics for all blast-radius services and return current values with delta from baseline.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        services: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        deploy_start_time: { type: SchemaType.STRING },
      },
      required: ['services', 'deploy_start_time'],
    },
  },
  {
    name: 'detect_anomaly',
    description: 'Determine if the latest telemetry tick represents a real regression or noise. Returns confidence, severity, and recommendation.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        current_metrics: { type: SchemaType.OBJECT },
        baseline: { type: SchemaType.OBJECT },
        deploy_age_minutes: { type: SchemaType.NUMBER },
      },
      required: ['current_metrics', 'baseline', 'deploy_age_minutes'],
    },
  },
  {
    name: 'pause_canary',
    description: 'Halt the canary rollout at its current traffic split via GitHub Actions or ArgoCD.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deployment_id: { type: SchemaType.STRING },
        reason: { type: SchemaType.STRING },
      },
      required: ['deployment_id', 'reason'],
    },
  },
  {
    name: 'fetch_failing_traces',
    description: 'Pull distributed traces for failing requests from Dynatrace to identify where errors originate in the call chain.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        service: { type: SchemaType.STRING },
        from_time: { type: SchemaType.STRING },
        to_time: { type: SchemaType.STRING },
      },
      required: ['service', 'from_time', 'to_time'],
    },
  },
  {
    name: 'identify_root_cause',
    description: 'Synthesize traces, metric deltas, and deployment diff to produce a root cause analysis with confidence score.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        traces: { type: SchemaType.OBJECT },
        metric_deltas: { type: SchemaType.OBJECT },
        deployment_diff: { type: SchemaType.OBJECT },
      },
      required: ['traces', 'metric_deltas'],
    },
  },
  {
    name: 'check_rollback_safety',
    description: 'Determine if rollback is safe given DB migrations and data written since deploy.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deployment_diff: { type: SchemaType.OBJECT },
        root_cause: { type: SchemaType.OBJECT },
      },
      required: ['deployment_diff'],
    },
  },
  {
    name: 'execute_rollback',
    description: 'Trigger rollback of the deployment via GitHub Actions workflow_dispatch.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deployment_id: { type: SchemaType.STRING },
        rollback_to_sha: { type: SchemaType.STRING },
        reason: { type: SchemaType.STRING },
        include_db_rollback: { type: SchemaType.BOOLEAN },
      },
      required: ['deployment_id', 'rollback_to_sha'],
    },
  },
  {
    name: 'write_flight_recorder_entry',
    description: 'Persist the full forensic deployment record to the database.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        session: { type: SchemaType.OBJECT, description: 'Full DeploymentSession object' },
      },
      required: ['session'],
    },
  },
  {
    name: 'detect_cross_deploy_regression',
    description: 'Scan recent metric trends to find regressions that span multiple deployments over time.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        lookback_window: { type: SchemaType.STRING, description: 'e.g. "7d"' },
        degradation_threshold_pct: { type: SchemaType.NUMBER },
      },
      required: [],
    },
  },
];
