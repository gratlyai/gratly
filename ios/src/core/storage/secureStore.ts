import * as SecureStore from "expo-secure-store";

const memoryCache = new Map<string, string>();

export const StorageKeys = {
  accessToken: "accessToken",
  userId: "userId",
  userName: "userName",
  restaurantKey: "restaurantKey",
  restaurantName: "restaurantName",
  rememberedEmail: "rememberedEmail",
  pushToken: "pushToken",
  permissionsPrefix: "employeePermissions:",
  profilePhotoPrefix: "profilePhotoUri:",
};

export const getPermissionStorageKey = (employeeId: string) =>
  `${StorageKeys.permissionsPrefix}${employeeId}`;

export const getProfilePhotoStorageKey = (employeeId: string) =>
  `${StorageKeys.profilePhotoPrefix}${employeeId}`;

export async function getItem(key: string): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(key);
    if (value !== null) {
      memoryCache.set(key, value);
      return value;
    }
  } catch {
    // Fall back to in-memory cache for development environments.
  }
  return memoryCache.get(key) ?? null;
}

export async function setItem(key: string, value: string): Promise<void> {
  memoryCache.set(key, value);
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Ignore secure store failures and keep in-memory value.
  }
}

export async function deleteItem(key: string): Promise<void> {
  memoryCache.delete(key);
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Ignore secure store failures.
  }
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJson<T>(key: string, value: T): Promise<void> {
  await setItem(key, JSON.stringify(value));
}
