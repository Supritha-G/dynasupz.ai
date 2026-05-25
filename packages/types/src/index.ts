// ─── Enums ───────────────────────────────────────────────────────────────────

export type RiskScore = 'low' | 'medium' | 'high' | 'critical';
export type DeploymentOutcome =
  | 'approved'
  | 'rolled_back'
  | 'paused'
  | 'blocked_by_policy';
export type AnomalyType =
  | 'latency_spike'
  | 'error_rate_increase'
  | 'throughput_drop'
  | 'none';
export type Recommendation = 'continue' | 'pause_canary' | 'investigate' | 'rollback';
export type ImpactLevel = 'none' | 'low' | 'medium' | 'high';

export type DeploymentState =
  | 'IDLE'
  | 'PRE_DEPLOY_ANALYSIS'
  | 'RISK_SCORED'
  | 'BASELINE_CAPTURED'
  | 'MONITORING_LIVE'
  | 'INVESTIGATING'
  | 'ROLLING_BACK'
  | 'AWAITING_HUMAN'
  | 'ROLLED_BACK'
  | 'APPROVED'
  | 'STEADY_STATE_CONFIRMED'
  | 'BLOCKED_BY_POLICY';

// ─── Skill Outputs ────────────────────────────────────────────────────────────

export interface TopologyResult {
  root_service: string;
  dependency_graph: Record<string, string[]>;
  total_affected_services: number;
  dynatrace_entity_ids: Record<string, string>;
}

export interface DiffAnalysisResult {
  directly_changed_services: string[];
  changed_file_categories: {
    db_migration: boolean;
    api_contract_change: boolean;
    config_change: boolean;
    business_logic: boolean;
  };
  changed_files_summary: string[];
}

export interface BlastRadiusResult {
  risk_score: RiskScore;
  risk_reasoning: string;
  impact_map: Record<string, ImpactLevel>;
  risk_factors: string[];
}

export interface BaselineSnapshot {
  snapshot_timestamp: string;
  baselines: Record<string, ServiceMetrics>;
}

export interface ServiceMetrics {
  p50_ms: number;
  p99_ms: number;
  error_rate_pct: number;
  rps: number;
}

export interface PolicyResult {
  policy: string;
  decision: 'pass' | 'block';
  reason: string;
  metric_value?: number;
  threshold?: number;
}

export interface PolicyEvalResult {
  overall_decision: 'pass' | 'block';
  policy_results: PolicyResult[];
}

export interface TelemetryTick {
  tick_timestamp: string;
  metrics: Record<string, ServiceMetrics & { delta_from_baseline: Record<string, string> }>;
  alert_candidates: string[];
}

export interface AnomalyResult {
  is_anomaly: boolean;
  confidence: number;
  affected_services: string[];
  anomaly_type: AnomalyType;
  severity: RiskScore;
  recommendation: Recommendation;
  reasoning: string;
}

export interface TraceResult {
  total_failing_requests: number;
  sample_traces: Array<{
    trace_id: string;
    root_service: string;
    error_service: string;
    error_message: string;
    call_chain: string[];
    duration_ms: number;
    error_code: string;
  }>;
  error_pattern: string;
  error_concentrated_in: string;
}

export interface RootCauseResult {
  root_service: string;
  root_cause_description: string;
  implicated_change: string;
  confidence: number;
  recommended_action: Recommendation;
}

export interface RollbackSafetyResult {
  rollback_safe: boolean;
  reason: string;
  requires_manual_approval: boolean;
  safe_operations: string[];
  risky_operations: string[];
}

export interface RollbackResult {
  rollback_initiated: boolean;
  rollback_run_id: string;
  estimated_completion_sec: number;
  rollback_url: string;
}

// ─── Reasoning Chain ─────────────────────────────────────────────────────────

export interface ReasoningStep {
  timestamp: string;
  skill: string;
  input_summary: string;
  output_summary: string;
  decision?: string;
  confidence?: number;
}

// ─── Deployment Session ───────────────────────────────────────────────────────

export interface DeploymentSession {
  id: string;
  state: DeploymentState;
  repo: string;
  service: string;
  commit_sha: string;
  base_sha: string;
  deployment_id: string;
  commit_message: string;
  triggered_by: string;
  started_at: string;

  topology?: TopologyResult;
  diff_analysis?: DiffAnalysisResult;
  blast_radius?: BlastRadiusResult;
  policy_evaluation?: PolicyEvalResult;
  baseline_metrics?: BaselineSnapshot;

  telemetry_ticks: TelemetryTick[];
  anomaly_detected: boolean;
  anomaly_result?: AnomalyResult;

  traces?: TraceResult;
  root_cause?: RootCauseResult;
  rollback_safety?: RollbackSafetyResult;
  rollback_result?: RollbackResult;

  reasoning_chain: ReasoningStep[];
}

// ─── Flight Recorder Record ───────────────────────────────────────────────────

export interface DeploymentRecord {
  id: string;
  created_at: string;
  repo: string;
  service: string;
  commit_sha: string;
  commit_message: string;
  triggered_by: string;
  outcome: DeploymentOutcome;
  risk_score: RiskScore;
  blast_radius: BlastRadiusResult | null;
  baseline_metrics: BaselineSnapshot | null;
  anomaly_detected: boolean;
  anomaly_type: AnomalyType | null;
  root_cause_analysis: RootCauseResult | null;
  rollback_executed: boolean;
  reasoning_chain: ReasoningStep[];
  deploy_started_at: string | null;
  deploy_completed_at: string | null;
  steady_state_confirmed_at: string | null;
}

// ─── API Payloads ─────────────────────────────────────────────────────────────

export interface CreateDeploymentDto {
  event: 'pre_deploy' | 'deploy_complete' | 'rollback_complete';
  repo: string;
  service: string;
  commit_sha: string;
  base_sha: string;
  deployment_id: string;
  commit_message?: string;
  triggered_by?: string;
}

export interface DeploymentActionDto {
  action: 'approve' | 'force_rollback' | 'notify_oncall';
  actor: string;
}

// ─── SSE Events ──────────────────────────────────────────────────────────────

export interface SSEEvent {
  type:
    | 'state_change'
    | 'telemetry_tick'
    | 'anomaly_detected'
    | 'reasoning_step'
    | 'session_complete';
  deployment_id: string;
  timestamp: string;
  data: unknown;
}
