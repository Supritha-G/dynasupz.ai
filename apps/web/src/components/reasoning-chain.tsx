'use client';

import { useEffect, useRef } from 'react';
import { ReasoningStep } from '@dynasupz/types';

export function ReasoningChain({ steps }: { steps: ReasoningStep[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps.length]);

  if (steps.length === 0) {
    return (
      <div className="border border-gray-800 rounded-lg p-8 text-center text-gray-500">
        Agent reasoning will appear here...
      </div>
    );
  }

  return (
    <div className="border border-gray-800 rounded-lg divide-y divide-gray-800/50 max-h-[600px] overflow-y-auto">
      {steps.map((step, i) => (
        <div key={i} className="px-4 py-3 space-y-1">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600 font-mono w-24 shrink-0">
              {new Date(step.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-xs font-semibold text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded">
              {step.skill}
            </span>
            {step.decision && (
              <span className="text-xs text-gray-300">{step.decision}</span>
            )}
          </div>
          <p className="text-xs text-gray-500 pl-28">{step.output_summary}</p>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
