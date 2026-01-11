import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { login } from "../../core/api/auth";
import { setAuthFailureHandler } from "../../core/api/client";
import { fetchUserPermissions } from "../../core/api/permissions";
import {
  defaultEmployeePermissions,
  getStoredPermissions,
  setStoredPermissions,
  type PermissionState,
} from "../../core/auth/permissions";
import {
  deleteItem,
  getItem,
  setItem,
  StorageKeys,
} from "../../core/storage/secureStore";
import { registerPushTokenIfNeeded } from "../../core/notifications/notifications";
import { clearAccessToken, setAccessToken } from "../../core/api/client";

export type Session = {
  userId: string;
  userName: string | null;
  restaurantKey: string | null;
  restaurantName: string | null;
  permissions: PermissionState;
  isBusinessUser: boolean;
};

export type AuthContextValue = {
  session: Session | null;
  isLoading: boolean;
  rememberedEmail: string | null;
  signIn: (email: string, password: string, rememberEmail: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  updateSessionUserName: (value: string | null) => void;
  setRememberedEmail: (value: string | null) => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const clearSessionStorage = async () => {
  await Promise.all([
    clearAccessToken(),
    deleteItem(StorageKeys.userId),
    deleteItem(StorageKeys.userName),
    deleteItem(StorageKeys.restaurantKey),
    deleteItem(StorageKeys.restaurantName),
    deleteItem(StorageKeys.pushToken),
  ]);
};

const computeIsBusinessUser = (permissions: PermissionState) =>
  permissions.adminAccess ||
  permissions.managerAccess ||
  permissions.createPayoutSchedules ||
  permissions.approvePayouts ||
  permissions.manageTeam ||
  permissions.superadminAccess;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [rememberedEmail, setRememberedEmailState] = useState<string | null>(null);

  const updateSessionUserName = useCallback((value: string | null) => {
    setSession((prev) => (prev ? { ...prev, userName: value } : prev));
  }, []);

  const loadSession = useCallback(async () => {
    setIsLoading(true);
    const [token, userId, userName, restaurantKey, restaurantName, savedEmail] = await Promise.all([
      getItem(StorageKeys.accessToken),
      getItem(StorageKeys.userId),
      getItem(StorageKeys.userName),
      getItem(StorageKeys.restaurantKey),
      getItem(StorageKeys.restaurantName),
      getItem(StorageKeys.rememberedEmail),
    ]);
    setRememberedEmailState(savedEmail);
    if (!token || !userId) {
      setSession(null);
      setIsLoading(false);
      return;
    }
    let permissions = await getStoredPermissions(userId);
    const numericUserId = Number(userId);
    if (Number.isFinite(numericUserId)) {
      try {
        permissions = await fetchUserPermissions(numericUserId);
        await setStoredPermissions(userId, permissions);
      } catch {
        // Keep cached permissions on failure.
      }
    }
    const isBusinessUser = computeIsBusinessUser(permissions);
    setSession({
      userId,
      userName: userName ?? null,
      restaurantKey: restaurantKey ?? null,
      restaurantName: restaurantName ?? null,
      permissions,
      isBusinessUser,
    });
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadSession();
    setAuthFailureHandler(() => {
      void clearSessionStorage().then(() => setSession(null));
    });
    return () => {
      setAuthFailureHandler(null);
    };
  }, [loadSession]);

  useEffect(() => {
    if (!session) {
      return;
    }
    registerPushTokenIfNeeded().catch((error) => {
      console.warn("Failed to register push token:", error);
    });
  }, [session]);

  const signIn = useCallback(
    async (email: string, password: string, rememberEmail: boolean) => {
      const data = await login(email, password);
      if (!data.success) {
        throw new Error(data.detail || "Login failed.");
      }
      if (data.access_token) {
        await setAccessToken(String(data.access_token));
      } else {
        await clearAccessToken();
      }
      if (data.user_id) {
        await setItem(StorageKeys.userId, String(data.user_id));
      }
      const fullName = `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim();
      if (fullName) {
        await setItem(StorageKeys.userName, fullName);
      } else {
        await deleteItem(StorageKeys.userName);
      }
      if (data.restaurant_key) {
        await setItem(StorageKeys.restaurantKey, String(data.restaurant_key));
        if (data.restaurant_name) {
          await setItem(StorageKeys.restaurantName, String(data.restaurant_name));
        } else {
          await deleteItem(StorageKeys.restaurantName);
        }
      }
      if (rememberEmail) {
        await setItem(StorageKeys.rememberedEmail, email);
        setRememberedEmailState(email);
      } else {
        await deleteItem(StorageKeys.rememberedEmail);
        setRememberedEmailState(null);
      }

      const userId = data.user_id ? String(data.user_id) : "";
      if (!userId) {
        await clearSessionStorage();
        throw new Error("Missing user ID in login response.");
      }
      let permissions = await getStoredPermissions(userId);
      if (data.user_id) {
        try {
          permissions = await fetchUserPermissions(data.user_id);
          await setStoredPermissions(userId, permissions);
        } catch {
          // Keep cached permissions on failure.
        }
      }
      const isBusinessUser = computeIsBusinessUser(permissions);
      setSession({
        userId,
        userName: fullName || null,
        restaurantKey: data.restaurant_key ? String(data.restaurant_key) : null,
        restaurantName: data.restaurant_name ? String(data.restaurant_name) : null,
        permissions,
        isBusinessUser,
      });
    },
    [],
  );

  const signOut = useCallback(async () => {
    await clearSessionStorage();
    setSession(null);
  }, []);

  const refreshPermissions = useCallback(async () => {
    if (!session?.userId) {
      return;
    }
    const numericUserId = Number(session.userId);
    if (!Number.isFinite(numericUserId)) {
      return;
    }
    try {
      const permissions = await fetchUserPermissions(numericUserId);
      await setStoredPermissions(session.userId, permissions);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              permissions,
              isBusinessUser: computeIsBusinessUser(permissions),
            }
          : prev,
      );
    } catch {
      // Ignore refresh errors.
    }
  }, [session]);

  const setRememberedEmail = useCallback(async (value: string | null) => {
    if (value) {
      await setItem(StorageKeys.rememberedEmail, value);
      setRememberedEmailState(value);
    } else {
      await deleteItem(StorageKeys.rememberedEmail);
      setRememberedEmailState(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      rememberedEmail,
      signIn,
      signOut,
      refreshPermissions,
      updateSessionUserName,
      setRememberedEmail,
    }),
    [
      session,
      isLoading,
      rememberedEmail,
      signIn,
      signOut,
      refreshPermissions,
      updateSessionUserName,
      setRememberedEmail,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
