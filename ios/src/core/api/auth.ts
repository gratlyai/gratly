import { api } from "./client";

export type LoginResponse = {
  success: boolean;
  access_token?: string;
  user_id?: number;
  first_name?: string | null;
  last_name?: string | null;
  restaurant_key?: string | null;
  restaurant_name?: string | null;
  detail?: string | null;
};

export type SignupResponse = {
  success: boolean;
  user_id?: number;
  restaurant_key?: string | null;
  detail?: string | null;
};

export async function login(email: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>(
    "/login",
    { email, password },
    { timeout: 10000, skipAuthRefresh: true },
  );
}

export async function signup(payload: {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
  inviteToken?: string;
}): Promise<SignupResponse> {
  return api.post<SignupResponse>("/signup", payload, { skipAuthRefresh: true });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await api.post("/password-reset/request", { email }, { skipAuthRefresh: true });
}

export async function confirmPasswordReset(token: string, password: string): Promise<void> {
  await api.post("/password-reset/confirm", { token, password }, { skipAuthRefresh: true });
}
