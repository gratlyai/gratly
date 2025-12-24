export type PermissionKey =
  | "createPayoutSchedules"
  | "approvePayouts"
  | "manageTeam"
  | "adminAccess"
  | "employeeOnly";

export type PermissionState = Record<PermissionKey, boolean>;

export const permissionConfig: { key: PermissionKey; label: string }[] = [
  { key: "createPayoutSchedules", label: "Create Payout Schedules" },
  { key: "approvePayouts", label: "Approve Payouts" },
  { key: "manageTeam", label: "Manage Team" },
  { key: "adminAccess", label: "Admin Access" },
  { key: "employeeOnly", label: "Employee Only" },
];

export const OWNER_NAME = "abida shaik";

export const defaultEmployeePermissions: PermissionState = {
  createPayoutSchedules: false,
  approvePayouts: false,
  manageTeam: false,
  adminAccess: false,
  employeeOnly: true,
};

export const adminPermissions: PermissionState = {
  createPayoutSchedules: true,
  approvePayouts: true,
  manageTeam: true,
  adminAccess: true,
  employeeOnly: true,
};

const normalizeName = (value: string) => value.trim().toLowerCase();

export const isOwner = (userName?: string | null) =>
  normalizeName(userName ?? "") === OWNER_NAME;

export const getStoredPermissions = (
  employeeId?: string | null,
  userName?: string | null,
): PermissionState => {
  if (isOwner(userName)) {
    return adminPermissions;
  }
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
  home: "employeeOnly",
  approvals: "approvePayouts",
  "shift-payout": "createPayoutSchedules",
  team: "manageTeam",
  reports: "approvePayouts",
  settings: "createPayoutSchedules",
  profile: null,
};
