import React, { useEffect } from "react";
import { Platform, Text, TextInput } from "react-native";
import { enableScreens } from "react-native-screens";
import { NavigationContainer } from "@react-navigation/native";
import { AuthProvider } from "./providers/AuthProvider";
import { navigationRef } from "./navigation/navigationRef";
import { attachNotificationResponseHandler } from "../core/notifications/notifications";
import RootNavigator from "./navigation/RootNavigator";

const baseFontFamily = Platform.select({ ios: "SF Pro Text", android: "Roboto" }) ?? "System";

const applyDefaultTypography = () => {
  const TextAny = Text as typeof Text & { defaultProps?: { style?: unknown } };
  const InputAny = TextInput as typeof TextInput & { defaultProps?: { style?: unknown } };
  const textDefaults = TextAny.defaultProps ?? {};
  TextAny.defaultProps = {
    ...textDefaults,
    style: [{ fontFamily: baseFontFamily, fontSize: 12 }, textDefaults.style],
  };

  const inputDefaults = InputAny.defaultProps ?? {};
  InputAny.defaultProps = {
    ...inputDefaults,
    style: [{ fontFamily: baseFontFamily, fontSize: 12 }, inputDefaults.style],
  };
};

enableScreens();
applyDefaultTypography();

const App = () => {
  useEffect(() => {
    const subscription = attachNotificationResponseHandler((screen, params) => {
      if (navigationRef.isReady()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        navigationRef.navigate(screen as never, params as never);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <AuthProvider>
      <NavigationContainer ref={navigationRef}>
        <RootNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
};

export default App;
