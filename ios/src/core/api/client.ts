import axios, { AxiosError, type AxiosInstance, type AxiosRequestConfig } from "axios";
import { deleteItem, getItem, setItem, StorageKeys } from "../storage/secureStore";

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type JsonValue =
  | Record<string, unknown>
  | Array<unknown>
  | string
  | number
  | boolean
  | null;

type RequestConfig = AxiosRequestConfig & {
  skipAuthRefresh?: boolean;
  _retry?: boolean;
};

type AuthFailureHandler = () => void;

let accessTokenCache: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
let authFailureHandler: AuthFailureHandler | null = null;

export function setAuthFailureHandler(handler: AuthFailureHandler | null) {
  authFailureHandler = handler;
}

export async function getAccessToken(): Promise<string | null> {
  if (accessTokenCache !== null) {
    return accessTokenCache;
  }
  const token = await getItem(StorageKeys.accessToken);
  accessTokenCache = token;
  return token;
}

export async function setAccessToken(token: string): Promise<void> {
  accessTokenCache = token;
  await setItem(StorageKeys.accessToken, token);
}

export async function clearAccessToken(): Promise<void> {
  accessTokenCache = null;
  await deleteItem(StorageKeys.accessToken);
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }
  refreshPromise = (async () => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        null,
        { withCredentials: true },
      );
      const token = response.data?.access_token;
      if (typeof token === "string" && token) {
        await setAccessToken(token);
        return token;
      }
      await clearAccessToken();
      return null;
    } catch {
      await clearAccessToken();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

apiClient.interceptors.request.use(async (config) => {
  const [token, userId] = await Promise.all([
    getAccessToken(),
    getItem(StorageKeys.userId),
  ]);
  if (userId) {
    config.headers = {
      ...config.headers,
      "X-User-Id": userId,
    };
  }
  if (token) {
    config.headers = {
      ...config.headers,
      Authorization: `Bearer ${token}`,
    };
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const status = error.response?.status;
    const originalRequest = error.config as RequestConfig | undefined;
    if (!originalRequest) {
      return Promise.reject(error);
    }
    if (status === 401 && !originalRequest.skipAuthRefresh && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        originalRequest.headers = {
          ...originalRequest.headers,
          Authorization: `Bearer ${refreshed}`,
        };
        return apiClient(originalRequest);
      }
      await clearAccessToken();
      authFailureHandler?.();
    }
    return Promise.reject(error);
  },
);

async function request<T>(
  method: "get" | "post" | "put" | "delete",
  path: string,
  body?: JsonValue,
  config?: RequestConfig,
): Promise<T> {
  const response = await apiClient.request<T>({
    url: path,
    method,
    data: body,
    ...config,
  });
  return response.data;
}

export const api = {
  get: <T>(path: string, config?: RequestConfig) => request<T>("get", path, undefined, config),
  post: <T>(path: string, body?: JsonValue, config?: RequestConfig) =>
    request<T>("post", path, body, config),
  put: <T>(path: string, body?: JsonValue, config?: RequestConfig) =>
    request<T>("put", path, body, config),
  delete: <T>(path: string, config?: RequestConfig) =>
    request<T>("delete", path, undefined, config),
};
