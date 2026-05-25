import Link from 'next/link';
import { RiskBadge } from '@/components/risk-badge';

async function getRecords() {
  try {
    const res = await fetch(`${process.env.API_URL}/records?limit=50`, { cache: 'no-store' });
    return res.json();
  } catch {
    return [];
  }
}

const OUTCOME_STYLES: Record<string, string> = {
  approved: 'text-green-400',
  rolled_back: 'text-red-400',
  paused: 'text-yellow-400',
  blocked_by_policy: 'text-orange-400',
};

export default async function RecordsPage() {
  const records = await getRecords();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Flight Recorder</h1>
        <p className="text-gray-400 text-sm mt-1">Full forensic history of every deployment</p>
      </div>

      <div className="border border-gray-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Service</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Commit</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Risk</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Outcome</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">By</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r: {
              id: string; service: string; commitSha: string;
              commitMessage: string; riskScore: string; outcome: string;
              triggeredBy: string; createdAt: string;
            }) => (
              <tr key={r.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                <td className="px-4 py-3">
                  <Link href={`/records/${r.id}`} className="font-medium text-white hover:text-blue-400">
                    {r.service}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-gray-400">{r.commitSha?.slice(0, 8)}</td>
                <td className="px-4 py-3">
                  {r.riskScore && <RiskBadge score={r.riskScore} />}
                </td>
                <td className="px-4 py-3">
                  <span className={OUTCOME_STYLES[r.outcome] ?? 'text-gray-400'}>
                    {r.outcome?.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400">{r.triggeredBy}</td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {records.length === 0 && (
          <div className="p-12 text-center text-gray-500">No deployment records yet</div>
        )}
      </div>
    </div>
  );
}
