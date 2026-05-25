import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VertexAI, FunctionDeclaration, Tool } from '@google-cloud/vertexai';
import { randomUUID } from 'crypto';
import {
  DeploymentSession,
  DeploymentState,
  SSEEvent,
  ReasoningStep,
} from '@dynasupz/types';
import { SkillsService } from '../skills/skills.service';
import { CreateDeploymentDto } from '../deployments/dto/create-deployment.dto';
import { SKILL_DECLARATIONS } from './skill-declarations';
import { SYSTEM_PROMPT } from './prompts';

const TERMINAL_STATES: DeploymentState[] = [
  'IDLE',
  'BLOCKED_BY_POLICY',
  'ROLLED_BACK',
  'APPROVED',
  'STEADY_STATE_CONFIRMED',
];

type SSEEmitter = (event: SSEEvent) => void;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly model;

  constructor(
    private readonly config: ConfigService,
    private readonly skills: SkillsService,
  ) {
    const vertexAI = new VertexAI({
      project: this.config.getOrThrow('GCP_PROJECT_ID'),
      location: this.config.get('GCP_LOCATION', 'us-central1'),
    });

    this.model = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-pro',
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 8192,
      },
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: SKILL_DECLARATIONS } as Tool],
    });
  }

  createSession(dto: CreateDeploymentDto): DeploymentSession {
    return {
      id: randomUUID(),
      state: 'PRE_DEPLOY_ANALYSIS',
      repo: dto.repo,
      service: dto.service,
      commit_sha: dto.commit_sha,
      base_sha: dto.base_sha,
      deployment_id: dto.deployment_id,
      commit_message: dto.commit_message ?? '',
      triggered_by: dto.triggered_by ?? 'unknown',
      started_at: new Date().toISOString(),
      telemetry_ticks: [],
      anomaly_detected: false,
      reasoning_chain: [],
    };
  }

  async runLoop(session: DeploymentSession, emit: SSEEmitter): Promise<void> {
    const chat = this.model.startChat();
    const initialMessage = this.buildInitialMessage(session);

    this.logger.log(`Starting agent loop for session ${session.id}`);

    let response = await chat.sendMessage(initialMessage);
    let iterations = 0;
    const MAX_ITERATIONS = 40;

    while (!TERMINAL_STATES.includes(session.state) && iterations < MAX_ITERATIONS) {
      iterations++;
      const candidate = response.response.candidates?.[0];
      if (!candidate) break;

      const toolCalls = candidate.content.parts?.filter((p) => p.functionCall) ?? [];

      if (toolCalls.length === 0) {
        // Agent produced text only — check if it's signaling a terminal decision
        this.logger.debug(`No tool calls at iteration ${iterations}, checking state`);
        break;
      }

      // Execute all tool calls (may be parallel)
      const toolResults = await Promise.all(
        toolCalls.map(async (part) => {
          const { name, args } = part.functionCall!;
          this.logger.log(`Calling skill: ${name}`);

          const result = await this.skills.execute(name, args as Record<string, unknown>, session);

          const step: ReasoningStep = {
            timestamp: new Date().toISOString(),
            skill: name,
            input_summary: JSON.stringify(args).slice(0, 200),
            output_summary: JSON.stringify(result).slice(0, 300),
          };
          session.reasoning_chain.push(step);

          emit({
            type: 'reasoning_step',
            deployment_id: session.id,
            timestamp: step.timestamp,
            data: step,
          });

          return {
            functionResponse: { name, response: result },
          };
        }),
      );

      // Update session state from skill results
      this.updateSessionState(session, toolCalls, toolResults);

      emit({
        type: 'state_change',
        deployment_id: session.id,
        timestamp: new Date().toISOString(),
        data: { state: session.state },
      });

      response = await chat.sendMessage(toolResults.map((r) => ({ functionResponse: r.functionResponse })));

      // Monitoring loop — wait between telemetry polls
      if (session.state === 'MONITORING_LIVE') {
        await this.sleep(60_000);
      }
    }

    // Always write flight recorder
    await this.skills.execute('write_flight_recorder_entry', { session }, session);

    emit({
      type: 'session_complete',
      deployment_id: session.id,
      timestamp: new Date().toISOString(),
      data: { outcome: this.stateToOutcome(session.state) },
    });

    this.logger.log(`Session ${session.id} complete — state: ${session.state}`);
  }

  async handleManualAction(
    session: DeploymentSession,
    action: 'approve' | 'force_rollback' | 'notify_oncall',
    actor: string,
  ) {
    if (action === 'approve') {
      session.state = 'APPROVED';
    } else if (action === 'force_rollback') {
      await this.skills.execute(
        'execute_rollback',
        { deployment_id: session.deployment_id, rollback_to_sha: session.base_sha, reason: `Manual rollback by ${actor}` },
        session,
      );
      session.state = 'ROLLED_BACK';
    }
    return { state: session.state };
  }

  private updateSessionState(session: DeploymentSession, toolCalls: unknown[], results: unknown[]) {
    // State transitions are driven by skill outputs written into session by SkillsService
    // This method handles guard transitions that aren't implicit in session fields
    if (session.policy_evaluation?.overall_decision === 'block' && session.state === 'RISK_SCORED') {
      session.state = 'BLOCKED_BY_POLICY';
    } else if (session.baseline_metrics && session.state === 'RISK_SCORED') {
      session.state = 'BASELINE_CAPTURED';
    } else if (session.anomaly_detected && session.state === 'MONITORING_LIVE') {
      session.state = 'INVESTIGATING';
    } else if (session.rollback_result && session.state === 'INVESTIGATING') {
      session.state = 'ROLLING_BACK';
    }
  }

  private buildInitialMessage(session: DeploymentSession): string {
    return `A new deployment has been triggered. Please begin your pre-deploy analysis.

Repo: ${session.repo}
Service: ${session.service}
Commit: ${session.commit_sha}
Base commit: ${session.base_sha}
Deployment ID: ${session.deployment_id}
Commit message: "${session.commit_message}"
Triggered by: ${session.triggered_by}
Timestamp: ${session.started_at}

Start by fetching the service topology and diff analysis in parallel, then profile the developer risk.`;
  }

  private stateToOutcome(state: DeploymentState) {
    if (state === 'ROLLED_BACK') return 'rolled_back';
    if (state === 'BLOCKED_BY_POLICY') return 'blocked_by_policy';
    return 'approved';
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
