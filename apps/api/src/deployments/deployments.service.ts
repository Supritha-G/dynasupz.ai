import { Injectable, NotFoundException } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { AgentService } from '../agent/agent.service';
import { CreateDeploymentDto } from './dto/create-deployment.dto';
import { DeploymentActionDto } from './dto/deployment-action.dto';
import { DeploymentSession, SSEEvent } from '@dynasupz/types';

@Injectable()
export class DeploymentsService {
  // In-memory active sessions. Persisted to DB via flight recorder at end.
  private sessions = new Map<string, DeploymentSession>();
  private eventBus = new Subject<SSEEvent>();

  constructor(private readonly agentService: AgentService) {}

  async create(dto: CreateDeploymentDto) {
    const session = this.agentService.createSession(dto);
    this.sessions.set(session.id, session);

    // Run agent loop in background — don't await
    this.agentService
      .runLoop(session, (event) => this.eventBus.next(event))
      .catch((err) => console.error(`Session ${session.id} failed:`, err));

    return { session_id: session.id, state: session.state };
  }

  findActive() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      service: s.service,
      state: s.state,
      risk_score: s.blast_radius?.risk_score ?? null,
      started_at: s.started_at,
    }));
  }

  findOne(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }

  async handleAction(id: string, dto: DeploymentActionDto) {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return this.agentService.handleManualAction(session, dto.action, dto.actor);
  }

  getStream(id: string): Observable<import('@nestjs/common').MessageEvent> {
    return this.eventBus.asObservable().pipe(
      filter((event) => event.deployment_id === id),
      map((event) => ({ data: event })),
    );
  }
}
