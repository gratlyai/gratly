import type { PermissionState } from "./permissions";

export type NavSectionKey = "home" | "approvals" | "shift-payout" | "team" | "reports" | "profile";

export const canAccessSection = (permissions: PermissionState, key: NavSectionKey) => {
  const isAdminUser = permissions.adminAccess || permissions.superadminAccess;
  if (key === "home" || key === "reports" || key === "profile") {
    return true;
  }
  if (key === "approvals") {
    return permissions.managerAccess || permissions.approvePayouts || isAdminUser;
  }
  if (key === "shift-payout") {
    return permissions.managerAccess || permissions.createPayoutSchedules || isAdminUser;
  }
  if (key === "team") {
    return permissions.managerAccess || permissions.manageTeam || isAdminUser;
  }
  return false;
};
