import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { registerDevice } from "../api/devices";
import { getItem, setItem, StorageKeys } from "../storage/secureStore";

export type NotificationRoutePayload = {
  screen?: string;
  id?: string;
  params?: Record<string, string | number | boolean | null>;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const getAppVersion = () => Constants.expoConfig?.version ?? "unknown";

export async function requestPushPermissions(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted || settings.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED) {
    return true;
  }
  const result = await Notifications.requestPermissionsAsync();
  return Boolean(result.granted || result.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED);
}

export async function getExpoPushToken(): Promise<string | null> {
  const granted = await requestPushPermissions();
  if (!granted) {
    return null;
  }
  const projectId =
    Constants.easConfig?.projectId ||
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.expoConfig?.projectId ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) {
    console.warn(
      'Push token registration skipped: missing Expo "projectId". Set expo.extra.eas.projectId or EXPO_PUBLIC_EAS_PROJECT_ID.',
    );
    return null;
  }
  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  return tokenResponse.data;
}

export async function registerPushTokenIfNeeded(): Promise<string | null> {
  const token = await getExpoPushToken();
  if (!token) {
    return null;
  }
  const stored = await getItem(StorageKeys.pushToken);
  if (stored === token) {
    return token;
  }
  await registerDevice({
    platform: Platform.OS === "android" ? "android" : "ios",
    pushToken: token,
    appVersion: getAppVersion(),
  });
  await setItem(StorageKeys.pushToken, token);
  return token;
}

export function attachNotificationResponseHandler(
  onNavigate: (screen: string, params?: Record<string, unknown>) => void,
) {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as NotificationRoutePayload | undefined;
    if (!data?.screen) {
      return;
    }
    const params = data.params ?? {};
    if (data.id) {
      params.id = data.id;
    }
    onNavigate(data.screen, params as Record<string, unknown>);
  });
}
