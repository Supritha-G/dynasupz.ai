const STYLES: Record<string, string> = {
  PRE_DEPLOY_ANALYSIS: 'bg-blue-900/50 text-blue-400',
  RISK_SCORED: 'bg-blue-900/50 text-blue-400',
  BASELINE_CAPTURED: 'bg-blue-900/50 text-blue-400',
  MONITORING_LIVE: 'bg-green-900/50 text-green-400',
  INVESTIGATING: 'bg-orange-900/50 text-orange-400',
  ROLLING_BACK: 'bg-red-900/50 text-red-400',
  AWAITING_HUMAN: 'bg-yellow-900/50 text-yellow-400',
  ROLLED_BACK: 'bg-red-900/50 text-red-400',
  APPROVED: 'bg-green-900/50 text-green-400',
  STEADY_STATE_CONFIRMED: 'bg-green-900/50 text-green-400',
  BLOCKED_BY_POLICY: 'bg-orange-900/50 text-orange-400',
};

export function StateBadge({ state }: { state: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STYLES[state] ?? 'bg-gray-800 text-gray-400'}`}>
      {state.replace(/_/g, ' ')}
    </span>
  );
}
