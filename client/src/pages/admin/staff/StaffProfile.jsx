import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import StaffProfileContent from '../../../components/StaffProfileContent.jsx';

export default function StaffProfile() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const [emp, setEmp]         = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get(`/admin/staff/${id}`)
      .then(r => setEmp(r.data.employee))
      .catch(() => setError('Failed to load staff profile.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="h-screen bg-deep flex items-center justify-center">
        <p className="text-fog text-sm">Loading profile…</p>
      </div>
    );
  }

  if (error || !emp) {
    return (
      <div className="h-screen bg-deep flex items-center justify-center gap-3">
        <p className="text-red-400 text-sm">{error || 'Staff member not found.'}</p>
        <button onClick={() => window.close()} className="text-10 font-bold tracking-widest uppercase text-fog hover:text-ink transition-colors">
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-deep flex flex-col overflow-hidden">
      <StaffProfileContent
        emp={emp}
        onUpdated={setEmp}
        onDeleted={() => window.close()}
        currentUser={currentUser}
        onClose={() => window.close()}
        popoutHref={null}
      />
    </div>
  );
}
