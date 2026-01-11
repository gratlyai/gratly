import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { MainTabParamList } from "./types";
import HomeScreen from "../screens/HomeScreen";
import ApprovalsScreen from "../screens/ApprovalsScreen";
import ShiftPayoutScreen from "../screens/ShiftPayoutScreen";
import ReportsScreen from "../screens/ReportsScreen";
import TeamStack from "./TeamStack";
import SettingsStack from "./SettingsStack";
import { useAuth } from "../providers/useAuth";
import { defaultEmployeePermissions } from "../../core/auth/permissions";
import { canAccessSection } from "../../core/auth/navigation";

const Tab = createBottomTabNavigator<MainTabParamList>();

const MainTabs = () => {
  const { session } = useAuth();
  const permissions = session?.permissions ?? defaultEmployeePermissions;
  const isSuperAdmin = permissions.superadminAccess;

  const tabs = useMemo(
    () => [
      { name: "Home" as const, component: HomeScreen, visible: canAccessSection(permissions, "home") },
      {
        name: "Approvals" as const,
        component: ApprovalsScreen,
        visible: canAccessSection(permissions, "approvals"),
      },
      {
        name: "ShiftPayout" as const,
        component: ShiftPayoutScreen,
        visible: canAccessSection(permissions, "shift-payout"),
      },
      {
        name: "TeamStack" as const,
        component: TeamStack,
        visible: canAccessSection(permissions, "team"),
      },
      {
        name: "Reports" as const,
        component: ReportsScreen,
        visible: canAccessSection(permissions, "reports"),
      },
      {
        name: "SettingsStack" as const,
        component: SettingsStack,
        visible: true,
        options: {
          title: isSuperAdmin ? "Settings" : "Profile",
        },
      },
    ],
    [permissions, isSuperAdmin],
  );

  return (
    <Tab.Navigator screenOptions={{ tabBarStyle: { display: "none" }, headerShown: false }}>
      {tabs
        .filter((tab) => tab.visible)
        .map((tab) => (
          <Tab.Screen
            key={tab.name}
            name={tab.name}
            component={tab.component}
            options={{
              title: tab.options?.title,
            }}
          />
        ))}
    </Tab.Navigator>
  );
};

export default MainTabs;
