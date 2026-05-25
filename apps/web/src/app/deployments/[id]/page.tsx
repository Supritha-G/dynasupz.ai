'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { DeploymentSession, SSEEvent, ReasoningStep } from '@dynasupz/types';
import { RiskBadge } from '@/components/risk-badge';
import { StateBadge } from '@/components/state-badge';
import { MetricsChart } from '@/components/metrics-chart';
import { ReasoningChain } from '@/components/reasoning-chain';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export default function DeploymentPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<DeploymentSession | null>(null);
  const [activeTab, setActiveTab] = useState<'metrics' | 'investigation' | 'chain'>('metrics');

  // Initial load
  useEffect(() => {
    fetch(`${API}/deployments/${id}`)
      .then((r) => r.json())
      .then(setSession)
      .catch(console.error);
  }, [id]);

  // SSE live updates
  useEffect(() => {
    const es = new EventSource(`${API}/deployments/${id}/stream`);
    es.onmessage = (e) => {
      const event: SSEEvent = JSON.parse(e.data);
      setSession((prev) => {
        if (!prev) return prev;
        if (event.type === 'state_change') {
          return { ...prev, state: (event.data as { state: DeploymentSession['state'] }).state };
        }
        if (event.type === 'reasoning_step') {
          return { ...prev, reasoning_chain: [...prev.reasoning_chain, event.data as ReasoningStep] };
        }
        if (event.type === 'telemetry_tick') {
          return { ...prev, telemetry_ticks: [...prev.telemetry_ticks, event.data as DeploymentSession['telemetry_ticks'][0]] };
        }
        return prev;
      });
    };
    return () => es.close();
  }, [id]);

  if (!session) {
    return <div className="text-gray-400 p-8">Loading deployment session...</div>;
  }

  const tabs = [
    { key: 'metrics', label: 'Live Metrics' },
    { key: 'investigation', label: 'Investigation', hidden: !session.anomaly_detected },
    { key: 'chain', label: 'Reasoning Chain' },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{session.service}</h1>
            {session.blast_radius && <RiskBadge score={session.blast_radius.risk_score} />}
            <StateBadge state={session.state} />
          </div>
          <p className="text-gray-400 text-sm mt-1">
            {session.commit_sha.slice(0, 8)} · {session.commit_message}
          </p>
        </div>
        <div className="flex gap-2">
          <ActionButton label="Approve" color="green" deploymentId={id} action="approve" />
          <ActionButton label="Force Rollback" color="red" deploymentId={id} action="force_rollback" />
        </div>
      </div>

      {/* Blast Radius */}
      {session.blast_radius && (
        <div className="border border-gray-800 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Blast Radius</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(session.blast_radius.impact_map).map(([svc, impact]) => (
              <span
                key={svc}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  impact === 'high' ? 'bg-orange-900 text-orange-300' :
                  impact === 'medium' ? 'bg-yellow-900 text-yellow-300' :
                  'bg-gray-800 text-gray-400'
                }`}
              >
                {svc} · {impact}
              </span>
            ))}
          </div>
          <p className="text-gray-400 text-sm mt-3">{session.blast_radius.risk_reasoning}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-800">
        <div className="flex gap-1">
          {tabs.filter((t) => !t.hidden).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key as typeof activeTab)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'metrics' && (
        <MetricsChart ticks={session.telemetry_ticks} baseline={session.baseline_metrics} />
      )}

      {activeTab === 'investigation' && session.root_cause && (
        <div className="border border-red-900 rounded-lg p-5 space-y-3">
          <p className="text-xs text-red-400 uppercase tracking-wider">Root Cause Analysis</p>
          <p className="text-white">{session.root_cause.root_cause_description}</p>
          <div className="bg-gray-900 rounded p-3 font-mono text-sm text-yellow-300">
            {session.root_cause.implicated_change}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-gray-400 text-sm">Confidence</span>
            <div className="flex-1 bg-gray-800 rounded-full h-2">
              <div
                className="bg-red-500 h-2 rounded-full"
                style={{ width: `${session.root_cause.confidence * 100}%` }}
              />
            </div>
            <span className="text-white text-sm font-medium">
              {(session.root_cause.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}

      {activeTab === 'chain' && (
        <ReasoningChain steps={session.reasoning_chain} />
      )}
    </div>
  );
}

function ActionButton({
  label, color, deploymentId, action,
}: {
  label: string;
  color: 'green' | 'red';
  deploymentId: string;
  action: string;
}) {
  const handleClick = () => {
    fetch(`${API}/deployments/${deploymentId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, actor: 'dashboard-user' }),
    });
  };
  return (
    <button
      onClick={handleClick}
      className={`px-3 py-1.5 rounded text-sm font-medium ${
        color === 'green'
          ? 'bg-green-900 text-green-300 hover:bg-green-800'
          : 'bg-red-900 text-red-300 hover:bg-red-800'
      }`}
    >
      {label}
    </button>
  );
}
