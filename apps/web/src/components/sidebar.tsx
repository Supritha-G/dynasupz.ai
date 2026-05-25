'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

const NAV = [
  { href: '/', label: 'Active Deploys' },
  { href: '/records', label: 'Flight Recorder' },
  { href: '/policies', label: 'Policies' },
  { href: '/risk-profiles', label: 'Risk Profiles' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-52 border-r border-gray-800 flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-gray-800">
        <p className="text-white font-bold text-sm">AI Deployment</p>
        <p className="text-blue-400 font-bold text-sm">Guardian</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'block px-3 py-2 rounded text-sm transition-colors',
              pathname === item.href
                ? 'bg-blue-900/50 text-blue-300'
                : 'text-gray-400 hover:text-white hover:bg-gray-800',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-gray-800">
        <p className="text-xs text-gray-600">Powered by Gemini + Dynatrace</p>
      </div>
    </aside>
  );
}
