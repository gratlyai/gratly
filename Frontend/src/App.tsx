import { Routes, Route } from "react-router-dom";
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
import { PrivateRoute } from "./auth/PrivateRoute";
import AppLayout from "./layouts/AppLayout";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<GratlyLogin />} />
      <Route path="/login" element={<GratlyLogin />} />
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
