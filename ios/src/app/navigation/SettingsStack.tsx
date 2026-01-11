import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { SettingsStackParamList } from "./types";
import SettingsScreen from "../screens/SettingsScreen";
import BillingScreen from "../screens/BillingScreen";
import ProfileScreen from "../screens/ProfileScreen";
import { useAuth } from "../providers/useAuth";

const Stack = createNativeStackNavigator<SettingsStackParamList>();

const SettingsStack = () => {
  const { session } = useAuth();
  const isSuperAdmin = Boolean(session?.permissions.superadminAccess);

  return (
    <Stack.Navigator
      initialRouteName={isSuperAdmin ? "Settings" : "Profile"}
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Billing" component={BillingScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
    </Stack.Navigator>
  );
};

export default SettingsStack;
