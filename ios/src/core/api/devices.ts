import { api } from "./client";

export type RegisterDevicePayload = {
  platform: "ios" | "android";
  pushToken: string;
  appVersion: string;
};

export async function registerDevice(payload: RegisterDevicePayload): Promise<void> {
  await api.post("/devices/register", payload);
}
