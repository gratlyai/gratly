export type PermissionKey =
  | "createPayoutSchedules"
  | "approvePayouts"
  | "manageTeam"
  | "adminAccess"
  | "managerAccess"
  | "employeeOnly";

export type PermissionState = Record<PermissionKey, boolean>;

export const permissionConfig: { key: PermissionKey; label: string }[] = [
  { key: "createPayoutSchedules", label: "Create Payout Schedules" },
  { key: "approvePayouts", label: "Approve Payouts" },
  { key: "manageTeam", label: "Manage Team" },
  { key: "adminAccess", label: "Admin Access" },
  { key: "managerAccess", label: "Manager Access" },
  { key: "employeeOnly", label: "Employee Only" },
];

export const defaultEmployeePermissions: PermissionState = {
  createPayoutSchedules: false,
  approvePayouts: false,
  manageTeam: false,
  adminAccess: false,
  managerAccess: false,
  employeeOnly: true,
};

export const getStoredPermissions = (employeeId?: string | null): PermissionState => {
  if (!employeeId) {
    return defaultEmployeePermissions;
  }
  const stored = localStorage.getItem(`employeePermissions:${employeeId}`);
  if (!stored) {
    return defaultEmployeePermissions;
  }
  try {
    const parsed = JSON.parse(stored) as Partial<PermissionState>;
    return { ...defaultEmployeePermissions, ...parsed };
  } catch {
    return defaultEmployeePermissions;
  }
};

export const hasPermission = (
  permissions: PermissionState,
  permission?: PermissionKey | null,
) => {
  if (!permission) {
    return true;
  }
  if (permissions.adminAccess) {
    return true;
  }
  return Boolean(permissions[permission]);
};

export const routePermissionMap: Record<string, PermissionKey | null> = {
  home: null,
  approvals: "approvePayouts",
  "shift-payout": "createPayoutSchedules",
  team: "manageTeam",
  reports: null,
  settings: "adminAccess",
  profile: null,
  subscription: "adminAccess",
};
