import Link from 'next/link';
import { RiskBadge } from '@/components/risk-badge';
import { StateBadge } from '@/components/state-badge';

async function getActiveSessions() {
  try {
    const res = await fetch(`${process.env.API_URL}/deployments`, { cache: 'no-store' });
    return res.json();
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const sessions = await getActiveSessions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Active Deployments</h1>
          <p className="text-gray-400 text-sm mt-1">Guardian is watching {sessions.length} deployment{sessions.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="border border-gray-800 rounded-lg p-12 text-center">
          <p className="text-gray-500 text-lg">No active deployments</p>
          <p className="text-gray-600 text-sm mt-2">Guardian activates when a GitHub Actions webhook fires</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {sessions.map((s: { id: string; service: string; state: string; risk_score: string | null; started_at: string }) => (
            <Link
              key={s.id}
              href={`/deployments/${s.id}`}
              className="block border border-gray-800 rounded-lg p-5 hover:border-gray-600 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className="font-semibold text-white">{s.service}</span>
                  {s.risk_score && <RiskBadge score={s.risk_score} />}
                </div>
                <StateBadge state={s.state} />
              </div>
              <p className="text-gray-500 text-xs mt-2">
                Started {new Date(s.started_at).toLocaleString()}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
