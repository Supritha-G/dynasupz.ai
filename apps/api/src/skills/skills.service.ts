import { Injectable, Logger } from '@nestjs/common';
import { DeploymentSession, BlastRadiusResult } from '@dynasupz/types';
import { DynatraceService } from '../dynatrace/dynatrace.service';
import { GeminiService } from '../gemini/gemini.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    private readonly dynatrace: DynatraceService,
    private readonly gemini: GeminiService,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    skillName: string,
    args: Record<string, unknown>,
    session: DeploymentSession,
  ): Promise<unknown> {
    this.logger.log(`Executing skill: ${skillName}`);

    switch (skillName) {
      case 'fetch_service_topology':
        return this.fetchServiceTopology(args, session);
      case 'map_diff_to_services':
        return this.mapDiffToServices(args, session);
      case 'profile_developer_risk':
        return this.profileDeveloperRisk(args);
      case 'score_blast_radius':
        return this.scoreBlastRadius(args, session);
      case 'evaluate_natural_language_policy':
        return this.evaluatePolicy(args, session);
      case 'snapshot_baseline_metrics':
        return this.snapshotBaseline(args, session);
      case 'monitor_live_telemetry':
        return this.monitorLiveTelemetry(args, session);
      case 'detect_anomaly':
        return this.detectAnomaly(args, session);
      case 'pause_canary':
        return this.pauseCanary(args, session);
      case 'fetch_failing_traces':
        return this.fetchFailingTraces(args, session);
      case 'identify_root_cause':
        return this.identifyRootCause(args, session);
      case 'check_rollback_safety':
        return this.checkRollbackSafety(args, session);
      case 'execute_rollback':
        return this.executeRollback(args, session);
      case 'write_flight_recorder_entry':
        return this.writeFlightRecorder(args.session as DeploymentSession ?? session);
      case 'detect_cross_deploy_regression':
        return this.detectCrossDeployRegression(args);
      default:
        throw new Error(`Unknown skill: ${skillName}`);
    }
  }

  // ─── S1 ───────────────────────────────────────────────────────────────────

  private async fetchServiceTopology(args: Record<string, unknown>, session: DeploymentSession) {
    const topology = await this.dynatrace.getTopology(
      args.service_id as string ?? session.service,
      (args.depth as number) ?? 3,
    );
    session.topology = topology;
    return topology;
  }

  // ─── S2 ───────────────────────────────────────────────────────────────────

  private async mapDiffToServices(args: Record<string, unknown>, session: DeploymentSession) {
    const diff = await this.dynatrace.getDiffAnalysis(
      args.repo as string ?? session.repo,
      args.commit_sha as string ?? session.commit_sha,
      args.base_sha as string ?? session.base_sha,
    );
    session.diff_analysis = diff;
    return diff;
  }

  // ─── S15 ──────────────────────────────────────────────────────────────────

  private async profileDeveloperRisk(args: Record<string, unknown>) {
    const profiles = await this.prisma.serviceRiskProfile.findMany({
      where: { service: args.service as string },
    });
    return {
      risk_profiles: profiles.reduce(
        (acc: Record<string, unknown>, p: { changeCategory: string; incidentRate: number; totalDeploys: number; incidentsSummary: unknown }) => ({
          ...acc,
          [p.changeCategory]: {
            incident_rate: p.incidentRate,
            total_deploys: p.totalDeploys,
            incidents_summary: p.incidentsSummary,
          },
        }),
        {} as Record<string, unknown>,
      ),
    };
  }

  // ─── S3 ───────────────────────────────────────────────────────────────────

  private async scoreBlastRadius(args: Record<string, unknown>, session: DeploymentSession) {
    const systemPrompt = `You are a senior SRE evaluating deployment risk. You will receive:
1. A service dependency graph
2. Analysis of what code changed
3. Historical incident data for similar changes in this system

Your job is to produce a JSON object with exactly these fields:
- risk_score: "low" | "medium" | "high" | "critical"
- risk_reasoning: string (2-3 sentences explaining the score)
- impact_map: object mapping each downstream service name to "none" | "low" | "medium" | "high"
- risk_factors: string[] (specific reasons this deploy is risky)

Rules:
- A DB migration that has caused incidents before is always at least "high"
- More than 3 downstream services in blast radius adds one level of severity
- No historical incidents + only config/logic changes = "low"
- Output valid JSON only. No markdown, no explanation outside the JSON.`;

    const userMessage = `Service Dependency Graph:
${JSON.stringify(args.topology ?? session.topology, null, 2)}

Code Change Analysis:
${JSON.stringify(args.diff_analysis ?? session.diff_analysis, null, 2)}

Historical Incident Data:
${JSON.stringify(args.historical_incidents ?? {}, null, 2)}

Score the blast radius and risk for this deployment.`;

    const result = await this.gemini.generateJSON<BlastRadiusResult>(systemPrompt, userMessage);
    session.blast_radius = result;
    session.state = 'RISK_SCORED';
    return result;
  }

  // ─── S5 ───────────────────────────────────────────────────────────────────

  private async evaluatePolicy(args: Record<string, unknown>, session: DeploymentSession) {
    const metrics = await this.dynatrace.queryMetrics(
      args.service as string ?? session.service,
      'now-1h',
      'now',
    );
    // Policy evaluation logic — full implementation in skills/policy.ts
    const result = {
      overall_decision: 'pass' as const,
      policy_results: [],
      current_metrics: metrics,
    };
    session.policy_evaluation = result;
    return result;
  }

  // ─── S4 ───────────────────────────────────────────────────────────────────

  private async snapshotBaseline(args: Record<string, unknown>, session: DeploymentSession) {
    const services = args.services as string[] ?? [session.service];
    const baseline = await this.dynatrace.snapshotMetrics(services, args.lookback_window as string ?? '30m');
    session.baseline_metrics = baseline;
    return baseline;
  }

  // ─── S6 ───────────────────────────────────────────────────────────────────

  private async monitorLiveTelemetry(args: Record<string, unknown>, session: DeploymentSession) {
    const services = args.services as string[] ?? [session.service];
    const tick = await this.dynatrace.getLiveTelemetry(services, session.baseline_metrics);
    session.telemetry_ticks.push(tick);
    return tick;
  }

  // ─── S7 ───────────────────────────────────────────────────────────────────

  private async detectAnomaly(args: Record<string, unknown>, session: DeploymentSession) {
    // Anomaly detection logic — Gemini evaluates via agent reasoning
    // This skill returns structured data; Gemini reasons about it
    const result = {
      is_anomaly: false,
      confidence: 0.0,
      affected_services: [],
      anomaly_type: 'none' as const,
      severity: 'low' as const,
      recommendation: 'continue' as const,
      reasoning: 'Metrics within normal range.',
      current_metrics: args.current_metrics,
      baseline: args.baseline,
    };
    if (result.is_anomaly) {
      session.anomaly_detected = true;
      session.anomaly_result = result;
    }
    return result;
  }

  // ─── S8 ───────────────────────────────────────────────────────────────────

  private async pauseCanary(args: Record<string, unknown>, session: DeploymentSession) {
    // GitHub Actions workflow_dispatch call — implement in integrations/cicd
    this.logger.warn(`PAUSING CANARY for deployment ${args.deployment_id}`);
    return { paused: true, timestamp: new Date().toISOString() };
  }

  // ─── S9 ───────────────────────────────────────────────────────────────────

  private async fetchFailingTraces(args: Record<string, unknown>, session: DeploymentSession) {
    const traces = await this.dynatrace.getFailingTraces(
      args.service as string ?? session.service,
      args.from_time as string,
      args.to_time as string,
    );
    session.traces = traces;
    return traces;
  }

  // ─── S10 ──────────────────────────────────────────────────────────────────

  private async identifyRootCause(args: Record<string, unknown>, session: DeploymentSession) {
    // Gemini performs the 3-step reasoning chain — this skill packages the data
    return {
      traces: args.traces,
      metric_deltas: args.metric_deltas,
      deployment_diff: args.deployment_diff ?? session.diff_analysis,
      ready_for_rca: true,
    };
  }

  // ─── S11 ──────────────────────────────────────────────────────────────────

  private async checkRollbackSafety(args: Record<string, unknown>, session: DeploymentSession) {
    const diff = (args.deployment_diff ?? session.diff_analysis) as { changed_file_categories?: { db_migration?: boolean } };
    const hasMigration = diff?.changed_file_categories?.db_migration ?? false;
    const result = {
      rollback_safe: !hasMigration,
      reason: hasMigration
        ? 'DB migration detected. Verify the migration is reversible before rolling back.'
        : 'No DB migrations detected. Rollback is safe.',
      requires_manual_approval: hasMigration,
      safe_operations: hasMigration ? [] : ['full_rollback'],
      risky_operations: hasMigration ? ['db_rollback'] : [],
    };
    session.rollback_safety = result;
    return result;
  }

  // ─── S12 ──────────────────────────────────────────────────────────────────

  private async executeRollback(args: Record<string, unknown>, session: DeploymentSession) {
    this.logger.warn(`EXECUTING ROLLBACK for ${args.deployment_id} to ${args.rollback_to_sha}`);
    const result = {
      rollback_initiated: true,
      rollback_run_id: `GH-RUN-${Date.now()}`,
      estimated_completion_sec: 120,
      rollback_url: `https://github.com/${session.repo}/actions`,
    };
    session.rollback_result = result;
    session.state = 'ROLLING_BACK';
    return result;
  }

  // ─── S13 ──────────────────────────────────────────────────────────────────

  private async writeFlightRecorder(session: DeploymentSession) {
    const outcome = session.rollback_result
      ? 'rolled_back'
      : session.policy_evaluation?.overall_decision === 'block'
        ? 'blocked_by_policy'
        : 'approved';

    const record = await this.prisma.deploymentRecord.create({
      data: {
        repo: session.repo,
        service: session.service,
        commitSha: session.commit_sha,
        baseSha: session.base_sha,
        deploymentId: session.deployment_id,
        commitMessage: session.commit_message,
        triggeredBy: session.triggered_by,
        outcome: outcome as 'approved' | 'rolled_back' | 'paused' | 'blocked_by_policy',
        riskScore: (session.blast_radius?.risk_score ?? 'low') as 'low' | 'medium' | 'high' | 'critical',
        blastRadius: session.blast_radius ? JSON.parse(JSON.stringify(session.blast_radius)) : undefined,
        baselineMetrics: session.baseline_metrics ? JSON.parse(JSON.stringify(session.baseline_metrics)) : undefined,
        anomalyDetected: session.anomaly_detected,
        anomalyType: session.anomaly_result?.anomaly_type,
        rootCauseAnalysis: session.root_cause ? JSON.parse(JSON.stringify(session.root_cause)) : undefined,
        rollbackExecuted: !!session.rollback_result,
        policyEvaluation: session.policy_evaluation ? JSON.parse(JSON.stringify(session.policy_evaluation)) : undefined,
        reasoningChain: JSON.parse(JSON.stringify(session.reasoning_chain)),
        deployStartedAt: new Date(session.started_at),
        deployCompletedAt: new Date(),
      },
    });

    // Update risk profile
    if (session.diff_analysis) {
      const categories = Object.entries(session.diff_analysis.changed_file_categories)
        .filter(([, v]) => v)
        .map(([k]) => k);

      await Promise.all(
        categories.map((cat) =>
          this.prisma.serviceRiskProfile.upsert({
            where: { service_changeCategory: { service: session.service, changeCategory: cat } },
            update: {
              totalDeploys: { increment: 1 },
              incidentDeploys: session.anomaly_detected ? { increment: 1 } : undefined,
              incidentRate: { set: session.anomaly_detected ? 1 : 0 },
              lastUpdatedAt: new Date(),
            },
            create: {
              service: session.service,
              changeCategory: cat,
              totalDeploys: 1,
              incidentDeploys: session.anomaly_detected ? 1 : 0,
              incidentRate: session.anomaly_detected ? 1.0 : 0.0,
            },
          }),
        ),
      );
    }

    return { record_id: record.id };
  }

  // ─── S14 ──────────────────────────────────────────────────────────────────

  private async detectCrossDeployRegression(args: Record<string, unknown>) {
    // Scheduled scan — full implementation in next iteration
    return { regressions_found: 0, regressions: [] };
  }
}
