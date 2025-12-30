import type { ReactNode } from "react";
import { Navigate, Routes, Route, useParams } from "react-router-dom";
import GratlyLogin from "./GratlyLogin";
import GratlySignUp from "./GratlySignUp";
import GratlyHome from "./GratlyHome";
import Employees from "./pages/Employees";
import EmployeeProfile from "./pages/EmployeeProfile";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Reconciliation from "./pages/Reconciliation";
import GratlyShiftPayout from "./GratlyShiftPayout";
import GratlyProfile from "./GratlyProfile";
import PasswordReset from "./pages/PasswordReset";
import PasswordResetForm from "./pages/PasswordResetForm";
import Subscription from "./pages/Subscription";
import { PrivateRoute } from "./auth/PrivateRoute";
import AppLayout from "./layouts/AppLayout";
import { getStoredPermissions } from "./auth/permissions";

const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { restaurantKey } = useParams();
  const storedUserId = localStorage.getItem("userId") || "";
  const permissions = getStoredPermissions(storedUserId);
  const isAdminUser = permissions.adminAccess;
  if (!isAdminUser) {
    const fallbackPath = restaurantKey ? `/business/${restaurantKey}/home` : "/login";
    return <Navigate to={fallbackPath} replace />;
  }
  return <>{children}</>;
};

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GratlyLogin />} />
      <Route path="/login" element={<GratlyLogin />} />
      <Route path="/forgot-password" element={<PasswordReset />} />
      <Route path="/reset-password" element={<PasswordResetForm />} />
      <Route path="/signup" element={<GratlySignUp />} />
      <Route
        path="/business/:restaurantKey"
        element={
          <PrivateRoute>
            <AppLayout />
          </PrivateRoute>
        }
      >
        <Route path="home" element={<GratlyHome />} />
        <Route path="approvals" element={<Reconciliation />} />
        <Route path="shift-payout" element={<GratlyShiftPayout />} />
        <Route path="team" element={<Employees />} />
        <Route path="team/:employeeGuid" element={<EmployeeProfile />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<GratlyProfile />} />
        <Route
          path="subscription"
          element={
            <AdminRoute>
              <Subscription />
            </AdminRoute>
          }
        />
      </Route>
      <Route
        path="/employees/:employeeId"
        element={
          <PrivateRoute>
            <AppLayout />
          </PrivateRoute>
        }
      >
        <Route path="home" element={<GratlyHome />} />
        <Route path="approvals" element={<Reconciliation />} />
        <Route path="shift-payout" element={<GratlyShiftPayout />} />
        <Route path="team" element={<Employees />} />
        <Route path="team/:employeeGuid" element={<EmployeeProfile />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="profile" element={<GratlyProfile />} />
      </Route>
    </Routes>
  );
}
