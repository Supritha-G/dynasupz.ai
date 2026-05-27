import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TopologyResult,
  DiffAnalysisResult,
  BaselineSnapshot,
  TelemetryTick,
  TraceResult,
  ServiceMetrics,
} from '@dynasupz/types';

@Injectable()
export class DynatraceService {
  private readonly logger = new Logger(DynatraceService.name);
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly config: ConfigService) {
    const envId = this.config.getOrThrow('DYNATRACE_ENV_ID');
    this.baseUrl = `https://${envId}.live.dynatrace.com`;
    this.headers = {
      Authorization: `Api-Token ${this.config.getOrThrow('DYNATRACE_API_TOKEN')}`,
      'Content-Type': 'application/json',
    };
  }

  async getTopology(serviceId: string, depth = 3): Promise<TopologyResult> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v2/entities?entitySelector=type(SERVICE),entityName("${serviceId}")&fields=toRelationships`,
        { headers: this.headers },
      );
      const data = await res.json() as { entities?: Array<{ entityId: string; toRelationships?: { calls?: Array<{ id: string }> } }> };
      const root = data.entities?.[0];
      if (!root) return this.emptyTopology(serviceId);

      const graph: Record<string, string[]> = {};
      const entityIds: Record<string, string> = { [serviceId]: root.entityId };
      const queue: Array<{ name: string; id: string; depth: number }> = [
        { name: serviceId, id: root.entityId, depth: 0 },
      ];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= depth) continue;
        const calls = current.id
          ? await this.getDownstreamServices(current.id)
          : [];
        graph[current.name] = calls.map((c) => c.name);
        for (const child of calls) {
          entityIds[child.name] = child.id;
          queue.push({ ...child, depth: current.depth + 1 });
        }
      }

      return {
        root_service: serviceId,
        dependency_graph: graph,
        total_affected_services: Object.keys(graph).length,
        dynatrace_entity_ids: entityIds,
      };
    } catch (err) {
      this.logger.warn(`Topology fetch failed, using empty graph: ${err}`);
      return this.emptyTopology(serviceId);
    }
  }

  async getDiffAnalysis(
    repo: string,
    commitSha: string,
    baseSha: string,
  ): Promise<DiffAnalysisResult> {
    try {
      const token = process.env.GITHUB_TOKEN;
      const [org, repoName] = repo.split('/');
      const res = await fetch(
        `https://api.github.com/repos/${org}/${repoName}/compare/${baseSha}...${commitSha}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
      );
      const data = await res.json() as { files?: Array<{ filename: string }> };
      const files = (data.files ?? []).map((f) => f.filename);

      return {
        directly_changed_services: [repo.split('/')[1]],
        changed_file_categories: {
          db_migration: files.some((f) => f.includes('/db/') || f.includes('migrate') || f.endsWith('.sql')),
          api_contract_change: files.some((f) => f.includes('openapi') || f.includes('proto') || f.includes('schema')),
          config_change: files.some((f) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')),
          business_logic: files.some((f) => f.endsWith('.ts') || f.endsWith('.go') || f.endsWith('.py')),
        },
        changed_files_summary: files.slice(0, 20),
      };
    } catch (err) {
      this.logger.warn(`Diff analysis failed: ${err}`);
      return {
        directly_changed_services: [],
        changed_file_categories: { db_migration: false, api_contract_change: false, config_change: false, business_logic: false },
        changed_files_summary: [],
      };
    }
  }

  async queryMetrics(service: string, from: string, to: string): Promise<Record<string, unknown>> {
    try {
      const selector = [
        'builtin:service.response.time:percentile(50)',
        'builtin:service.response.time:percentile(99)',
        'builtin:service.errors.total.rate',
        'builtin:service.requestCount.rate',
      ].join(',');

      const res = await fetch(
        `${this.baseUrl}/api/v2/metrics/query?metricSelector=${selector}&entitySelector=entityName("${service}")&from=${from}&to=${to}&resolution=1m`,
        { headers: this.headers },
      );
      return res.json() as Promise<Record<string, unknown>>;
    } catch (err) {
      this.logger.warn(`Metrics query failed: ${err}`);
      return {};
    }
  }

  async snapshotMetrics(services: string[], lookback = '30m'): Promise<BaselineSnapshot> {
    const baselines: Record<string, ServiceMetrics> = {};
    await Promise.all(
      services.map(async (svc) => {
        const raw = await this.queryMetrics(svc, `now-${lookback}`, 'now');
        baselines[svc] = this.parseMetrics(raw);
      }),
    );
    return { snapshot_timestamp: new Date().toISOString(), baselines };
  }

  async getLiveTelemetry(
    services: string[],
    baseline?: BaselineSnapshot,
  ): Promise<TelemetryTick> {
    const metrics: TelemetryTick['metrics'] = {};
    await Promise.all(
      services.map(async (svc) => {
        const raw = await this.queryMetrics(svc, 'now-2m', 'now');
        const current = this.parseMetrics(raw);
        const base = baseline?.baselines[svc];
        metrics[svc] = {
          ...current,
          delta_from_baseline: base
            ? {
                p99_ms: `${((current.p99_ms - base.p99_ms) / base.p99_ms * 100).toFixed(1)}%`,
                error_rate_pct: `${((current.error_rate_pct - base.error_rate_pct) / Math.max(base.error_rate_pct, 0.01) * 100).toFixed(1)}%`,
              }
            : {},
        };
      }),
    );

    const alert_candidates = Object.entries(metrics)
      .filter(([, m]) => {
        const deltaP99 = parseFloat(m.delta_from_baseline.p99_ms ?? '0');
        const deltaErr = parseFloat(m.delta_from_baseline.error_rate_pct ?? '0');
        return deltaP99 > 50 || deltaErr > 200;
      })
      .map(([svc]) => svc);

    return { tick_timestamp: new Date().toISOString(), metrics, alert_candidates };
  }

  async getFailingTraces(service: string, fromTime: string, toTime: string): Promise<TraceResult> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v2/traces?entitySelector=entityName("${service}")&from=${fromTime}&to=${toTime}&errorType=FAILED_REQUEST&limit=50`,
        { headers: this.headers },
      );
      const data = await res.json() as { traces?: Array<{ traceId: string; rootServiceName: string; errorServiceName: string; rootCauseDetails?: string; spans?: Array<{ serviceName: string }> }> };
      const traces = data.traces ?? [];

      return {
        total_failing_requests: traces.length,
        sample_traces: traces.slice(0, 10).map((t) => ({
          trace_id: t.traceId,
          root_service: t.rootServiceName ?? service,
          error_service: t.errorServiceName ?? service,
          error_message: t.rootCauseDetails ?? 'Unknown error',
          call_chain: t.spans?.map((s) => s.serviceName) ?? [service],
          duration_ms: 0,
          error_code: 'UNKNOWN',
        })),
        error_pattern: traces[0]?.rootCauseDetails ?? 'No pattern identified',
        error_concentrated_in: service,
      };
    } catch (err) {
      this.logger.warn(`Trace fetch failed: ${err}`);
      return { total_failing_requests: 0, sample_traces: [], error_pattern: '', error_concentrated_in: service };
    }
  }

  private async getDownstreamServices(entityId: string): Promise<Array<{ name: string; id: string }>> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/v2/entities/${entityId}?fields=toRelationships`,
        { headers: this.headers },
      );
      const data = await res.json() as { toRelationships?: { calls?: Array<{ id: string; displayName: string }> } };
      return (data.toRelationships?.calls ?? []).map((c) => ({ name: c.displayName, id: c.id }));
    } catch {
      return [];
    }
  }

  private parseMetrics(raw: Record<string, unknown>): ServiceMetrics {
    const result = raw as {
      result?: Array<{
        metricId: string;
        data: Array<{ values: (number | null)[] }>;
      }>;
    };

    const extract = (metricId: string): number => {
      const series = result.result?.find((r) => r.metricId.startsWith(metricId));
      if (!series) return 0;
      const values = series.data.flatMap((d) => d.values).filter((v): v is number => v !== null);
      if (values.length === 0) return 0;
      return values.reduce((a, b) => a + b, 0) / values.length;
    };

    // Dynatrace response time is in microseconds → convert to ms
    const p50_us = extract('builtin:service.response.time:percentile(50)');
    const p99_us = extract('builtin:service.response.time:percentile(99)');

    return {
      p50_ms: Math.round(p50_us / 1000),
      p99_ms: Math.round(p99_us / 1000),
      error_rate_pct: parseFloat(extract('builtin:service.errors.total.rate').toFixed(3)),
      rps: Math.round(extract('builtin:service.requestCount.rate')),
    };
  }

  private emptyTopology(serviceId: string): TopologyResult {
    return {
      root_service: serviceId,
      dependency_graph: { [serviceId]: [] },
      total_affected_services: 1,
      dynatrace_entity_ids: {},
    };
  }
}
