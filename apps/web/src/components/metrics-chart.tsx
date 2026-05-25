'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { TelemetryTick, BaselineSnapshot } from '@dynasupz/types';

interface Props {
  ticks: TelemetryTick[];
  baseline?: BaselineSnapshot;
}

export function MetricsChart({ ticks, baseline }: Props) {
  if (ticks.length === 0) {
    return (
      <div className="border border-gray-800 rounded-lg p-8 text-center text-gray-500">
        Waiting for telemetry...
      </div>
    );
  }

  const services = Object.keys(ticks[0]?.metrics ?? {});

  return (
    <div className="space-y-6">
      {services.map((svc) => {
        const data = ticks.map((t) => ({
          time: new Date(t.tick_timestamp).toLocaleTimeString(),
          p99: t.metrics[svc]?.p99_ms ?? 0,
          errorRate: t.metrics[svc]?.error_rate_pct ?? 0,
        }));

        const baselineP99 = baseline?.baselines[svc]?.p99_ms;
        const baselineErr = baseline?.baselines[svc]?.error_rate_pct;

        return (
          <div key={svc} className="border border-gray-800 rounded-lg p-4">
            <p className="text-sm font-semibold text-white mb-4">{svc}</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-2">p99 Latency (ms)</p>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={data}>
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }} />
                    {baselineP99 && <ReferenceLine y={baselineP99} stroke="#4b5563" strokeDasharray="4 2" label={{ value: 'baseline', fontSize: 10, fill: '#6b7280' }} />}
                    <Line type="monotone" dataKey="p99" stroke="#60a5fa" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2">Error Rate (%)</p>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={data}>
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', fontSize: 12 }} />
                    {baselineErr !== undefined && <ReferenceLine y={baselineErr} stroke="#4b5563" strokeDasharray="4 2" />}
                    <Line type="monotone" dataKey="errorRate" stroke="#f87171" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
