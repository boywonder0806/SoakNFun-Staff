import { Link } from 'react-router-dom';
import { ANALYTICS_DISABLED_MSG } from '../lib/features.js';

export default function UnderDevelopment() {
  return (
    <div className="max-w-xl mx-auto mt-16 card rounded-lg p-10 text-center">
      <div className="w-11 h-11 mx-auto rounded-md bg-amber-50 text-amber-600 flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />
        </svg>
      </div>
      <h1 className="mt-4 text-base font-semibold text-gray-900">Temporarily unavailable</h1>
      <p className="mt-1.5 text-sm text-gray-500">{ANALYTICS_DISABLED_MSG}</p>
      <Link to="/reports/shared" className="btn-primary !rounded-md !py-2 !text-xs mt-6">Go to Shared Reports</Link>
    </div>
  );
}
