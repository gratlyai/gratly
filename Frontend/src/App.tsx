import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Routes, Route, useParams } from "react-router-dom";
import GratlyLogin from "./GratlyLogin";
import GratlySignUp from "./GratlySignUp";
import GratlyHome from "./GratlyHome";
import Employees from "./pages/Employees";
import EmployeeProfile from "./pages/EmployeeProfile";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Billing from "./pages/Billing";
import Reconciliation from "./pages/Reconciliation";
import GratlyShiftPayout from "./GratlyShiftPayout";
import GratlyProfile from "./GratlyProfile";
import PasswordReset from "./pages/PasswordReset";
import PasswordResetForm from "./pages/PasswordResetForm";
import AdminBilling from "./pages/AdminBilling";
import MoovOnboarding from "./pages/MoovOnboarding";
import { PrivateRoute } from "./auth/PrivateRoute";
import AppLayout from "./layouts/AppLayout";
import { getStoredPermissions } from "./auth/permissions";
import { fetchUserPermissions } from "./api/permissions";

const SuperAdminRoute = ({ children }: { children: ReactNode }) => {
  const { restaurantKey } = useParams();
  const storedUserId = localStorage.getItem("userId") || "";
  const [isAllowed, setIsAllowed] = useState<boolean | null>(() => {
    if (!storedUserId) {
      return false;
    }
    const cached = getStoredPermissions(storedUserId);
    return cached.superadminAccess ? true : null;
  });

  useEffect(() => {
    if (!storedUserId) {
      setIsAllowed(false);
      return;
    }
    const numericUserId = Number(storedUserId);
    if (!Number.isFinite(numericUserId)) {
      setIsAllowed(false);
      return;
    }
    if (isAllowed === true) {
      return;
    }
    fetchUserPermissions(numericUserId)
      .then((data) => {
        localStorage.setItem(`employeePermissions:${numericUserId}`, JSON.stringify(data));
        setIsAllowed(Boolean(data.superadminAccess));
      })
      .catch(() => {
        const permissions = getStoredPermissions(storedUserId);
        setIsAllowed(Boolean(permissions.superadminAccess));
      });
  }, [storedUserId]);

  if (isAllowed === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10 text-sm text-gray-600">
        Checking superadmin access...
      </div>
    );
  }
  if (!isAllowed) {
    const fallbackPath = restaurantKey ? `/business/${restaurantKey}/home` : "/login";
    return <Navigate to={fallbackPath} replace />;
  }
  return <>{children}</>;
};

const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { restaurantKey } = useParams();
  const storedUserId = localStorage.getItem("userId") || "";
  const [isAllowed, setIsAllowed] = useState<boolean | null>(() => {
    if (!storedUserId) {
      return false;
    }
    const cached = getStoredPermissions(storedUserId);
    return cached.adminAccess || cached.superadminAccess ? true : null;
  });

  useEffect(() => {
    if (!storedUserId) {
      setIsAllowed(false);
      return;
    }
    const numericUserId = Number(storedUserId);
    if (!Number.isFinite(numericUserId)) {
      setIsAllowed(false);
      return;
    }
    if (isAllowed === true) {
      return;
    }
    fetchUserPermissions(numericUserId)
      .then((data) => {
        localStorage.setItem(`employeePermissions:${numericUserId}`, JSON.stringify(data));
        setIsAllowed(Boolean(data.adminAccess || data.superadminAccess));
      })
      .catch(() => {
        const permissions = getStoredPermissions(storedUserId);
        setIsAllowed(Boolean(permissions.adminAccess || permissions.superadminAccess));
      });
  }, [storedUserId]);

  if (isAllowed === null) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10 text-sm text-gray-600">
        Checking admin access...
      </div>
    );
  }
  if (!isAllowed) {
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
        <Route
          path="billing"
          element={
            <AdminRoute>
              <Billing />
            </AdminRoute>
          }
        />
        <Route
          path="settings"
          element={
            <SuperAdminRoute>
              <Settings />
            </SuperAdminRoute>
          }
        />
        <Route
          path="admin/billing"
          element={
            <AdminRoute>
              <AdminBilling />
            </AdminRoute>
          }
        />
        <Route
          path="moov/onboarding"
          element={
            <PrivateRoute>
              <MoovOnboarding />
            </PrivateRoute>
          }
        />
        <Route path="profile" element={<GratlyProfile />} />
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
        <Route
          path="settings"
          element={
            <SuperAdminRoute>
              <Settings />
            </SuperAdminRoute>
          }
        />
        <Route
          path="moov/onboarding"
          element={
            <PrivateRoute>
              <MoovOnboarding />
            </PrivateRoute>
          }
        />
        <Route path="profile" element={<GratlyProfile />} />
      </Route>
    </Routes>
  );
}
