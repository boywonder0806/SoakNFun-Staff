import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { IS_HUB } from './lib/host.js';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout/Layout.jsx';
import Login from './pages/Login.jsx';
import Launcher from './pages/Launcher.jsx';
import Home from './pages/Home.jsx';
import Schedule from './pages/Schedule.jsx';
import Messages from './pages/Messages.jsx';
import Announcements from './pages/Announcements.jsx';
import SchedulerLayout from './pages/admin/SchedulerLayout.jsx';
import SchedulerView from './pages/admin/scheduler/Schedule.jsx';
import ShiftAssignments from './pages/admin/scheduler/ShiftAssignments.jsx';
import Positions from './pages/admin/scheduler/Positions.jsx';
import NetchexImport from './pages/admin/scheduler/NetchexImport.jsx';
import DailyAssignments from './pages/admin/scheduler/DailyAssignments.jsx';
import SystemAdminLayout from './pages/admin/SystemAdminLayout.jsx';
import SysAdminDepartments from './pages/admin/sysadmin/Departments.jsx';
import SysAdminLogs from './pages/admin/sysadmin/Logs.jsx';
import SysAdminAPI from './pages/admin/sysadmin/API.jsx';
import ManageStaff from './pages/admin/staff/ManageStaff.jsx';
import StaffProfile from './pages/admin/staff/StaffProfile.jsx';
import TimeOff from './pages/TimeOff.jsx';
import ShiftBoard from './pages/ShiftBoard.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Reports from './pages/Reports.jsx';
import Operations from './pages/Operations.jsx';

function ProtectedRoute({ children, adminOnly = false, sysadminOnly = false, managerOnly = false, managementOnly = false, staffPortal = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-bb-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  // Staff portal is gated during early development — sysadmins always pass
  if (staffPortal && user.role !== 'sysadmin' && !user.hasStaffAccess) return <Navigate to="/apps" replace />;
  if (sysadminOnly && user.role !== 'sysadmin') return <Navigate to="/home" replace />;
  if (adminOnly && user.role !== 'manager' && user.role !== 'sysadmin') return <Navigate to="/home" replace />;
  if (managerOnly && user.role !== 'manager') return <Navigate to="/home" replace />;
  if (managementOnly && user.role !== 'sysadmin' && !user.departments?.includes('Management')) return <Navigate to="/home" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();

  // The hub (www) is sign-in + launcher only — the staff portal itself lives
  // at portal.bluebayoustaff.com and receives the session via SSO handoff.
  if (IS_HUB) {
    return (
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/apps" replace /> : <Login />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/reset-password"  element={<ResetPassword />} />
        <Route
          path="/apps"
          element={
            <ProtectedRoute>
              <Launcher />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to={user ? '/apps' : '/login'} replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/home" replace /> : <Login />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route
        path="/apps"
        element={
          <ProtectedRoute>
            <Launcher />
          </ProtectedRoute>
        }
      />
      <Route path="/reset-password"  element={<ResetPassword />} />
      <Route
        path="/staff/profile/:id"
        element={
          <ProtectedRoute adminOnly staffPortal>
            <StaffProfile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute staffPortal>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="home"          element={<Home />} />
        <Route path="schedule"      element={<Schedule />} />
        <Route path="messages"      element={<Messages />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="timeoff"       element={<TimeOff />} />
        <Route path="shiftboard"    element={<ShiftBoard />} />
        <Route
          path="scheduler"
          element={
            <ProtectedRoute adminOnly>
              <SchedulerLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="schedule" replace />} />
          <Route path="schedule"    element={<SchedulerView />} />
          <Route path="assignments" element={<ShiftAssignments />} />
          <Route path="positions"   element={<Positions />} />
          <Route path="import"      element={<NetchexImport />} />
          <Route path="board"       element={<DailyAssignments />} />
        </Route>
        <Route
          path="sysadmin"
          element={
            <ProtectedRoute sysadminOnly>
              <SystemAdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="departments" replace />} />
          <Route path="departments"    element={<SysAdminDepartments />} />
          <Route path="logs"           element={<SysAdminLogs />} />
          <Route path="api"            element={<SysAdminAPI />} />
        </Route>
        <Route
          path="staff/manage"
          element={
            <ProtectedRoute adminOnly>
              <ManageStaff />
            </ProtectedRoute>
          }
        />
        <Route
          path="reports"
          element={
            <ProtectedRoute managementOnly>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="operations"
          element={
            <ProtectedRoute adminOnly>
              <Operations />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
