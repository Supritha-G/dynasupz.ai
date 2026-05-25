const STYLES: Record<string, string> = {
  low: 'bg-green-900/50 text-green-400 border-green-800',
  medium: 'bg-yellow-900/50 text-yellow-400 border-yellow-800',
  high: 'bg-orange-900/50 text-orange-400 border-orange-800',
  critical: 'bg-red-900/50 text-red-400 border-red-800',
};

export function RiskBadge({ score }: { score: string }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold border uppercase tracking-wide ${STYLES[score] ?? STYLES.low}`}>
      {score}
    </span>
  );
}
