import { api } from "./client";
import type { PermissionState } from "../auth/permissions";
import type { PermissionDescriptor } from "../auth/permissions";

export async function fetchUserPermissions(userId: number): Promise<PermissionState> {
  return api.get<PermissionState>(`/user-permissions/${userId}`);
}

export async function updateUserPermissions(
  userId: number,
  permissions: PermissionState,
  actorUserId?: number | null,
): Promise<PermissionState> {
  const params = new URLSearchParams();
  if (actorUserId) {
    params.set("actor_user_id", String(actorUserId));
  }
  const query = params.toString();
  const url = query ? `/user-permissions/${userId}?${query}` : `/user-permissions/${userId}`;
  return api.put<PermissionState>(url, permissions);
}

export async function fetchPermissionCatalog(): Promise<PermissionDescriptor[]> {
  return api.get<PermissionDescriptor[]>("/permissions/catalog");
}
