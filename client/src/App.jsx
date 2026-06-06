import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout/Layout.jsx';
import Login from './pages/Login.jsx';
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
import SysAdminUsers from './pages/admin/sysadmin/Users.jsx';
import SysAdminDepartments from './pages/admin/sysadmin/Departments.jsx';
import SysAdminLogs from './pages/admin/sysadmin/Logs.jsx';
import SysAdminAPI from './pages/admin/sysadmin/API.jsx';
import ManageStaff from './pages/admin/staff/ManageStaff.jsx';
import StaffProfile from './pages/admin/staff/StaffProfile.jsx';
import TimeOff from './pages/TimeOff.jsx';
import ShiftBoard from './pages/ShiftBoard.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Reports from './pages/Reports.jsx';

function ProtectedRoute({ children, adminOnly = false, sysadminOnly = false, managerOnly = false, managementOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen text-bb-muted">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (sysadminOnly && user.role !== 'sysadmin') return <Navigate to="/home" replace />;
  if (adminOnly && user.role !== 'manager' && user.role !== 'sysadmin') return <Navigate to="/home" replace />;
  if (managerOnly && user.role !== 'manager') return <Navigate to="/home" replace />;
  if (managementOnly && user.role !== 'sysadmin' && !user.departments?.includes('Management')) return <Navigate to="/home" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/home" replace /> : <Login />} />
      <Route path="/change-password" element={<ChangePassword />} />
      <Route
        path="/staff/profile/:id"
        element={
          <ProtectedRoute adminOnly>
            <StaffProfile />
          </ProtectedRoute>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
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
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users"          element={<SysAdminUsers />} />
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
