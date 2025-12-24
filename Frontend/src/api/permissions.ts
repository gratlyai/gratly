import { api } from "./client";
import type { PermissionState } from "../auth/permissions";

export async function fetchUserPermissions(userId: number): Promise<PermissionState> {
  return api.get<PermissionState>(`/user-permissions/${userId}`);
}

export async function updateUserPermissions(
  userId: number,
  permissions: PermissionState,
): Promise<PermissionState> {
  return api.put<PermissionState>(`/user-permissions/${userId}`, permissions);
}
