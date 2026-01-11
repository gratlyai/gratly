import { getJson, getPermissionStorageKey, setJson } from "../storage/secureStore";

export type PermissionKey =
  | "createPayoutSchedules"
  | "approvePayouts"
  | "manageTeam"
  | "adminAccess"
  | "superadminAccess"
  | "managerAccess"
  | "employeeOnly";

export type PermissionState = Record<PermissionKey, boolean>;

export type PermissionDescriptor = { key: PermissionKey; label: string };

export const permissionConfig: PermissionDescriptor[] = [
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
  superadminAccess: false,
  managerAccess: false,
  employeeOnly: true,
};

const permissionsCache = new Map<string, PermissionState>();

export async function getStoredPermissions(
  employeeId?: string | null,
): Promise<PermissionState> {
  if (!employeeId) {
    return defaultEmployeePermissions;
  }
  const cached = permissionsCache.get(employeeId);
  if (cached) {
    return cached;
  }
  const key = getPermissionStorageKey(employeeId);
  const stored = await getJson<Partial<PermissionState>>(key);
  const merged = { ...defaultEmployeePermissions, ...(stored ?? {}) };
  permissionsCache.set(employeeId, merged);
  return merged;
}

export async function setStoredPermissions(
  employeeId: string,
  permissions: PermissionState,
): Promise<void> {
  const key = getPermissionStorageKey(employeeId);
  permissionsCache.set(employeeId, permissions);
  await setJson(key, permissions);
}

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
  if (permissions.superadminAccess) {
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
  billing: "adminAccess",
  settings: "adminAccess",
  profile: null,
};
