import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { TeamStackParamList } from "./types";
import TeamScreen from "../screens/TeamScreen";
import EmployeeProfileScreen from "../screens/EmployeeProfileScreen";

const Stack = createNativeStackNavigator<TeamStackParamList>();

const TeamStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="TeamList" component={TeamScreen} options={{ title: "Team" }} />
    <Stack.Screen name="EmployeeProfile" component={EmployeeProfileScreen} options={{ title: "Employee" }} />
  </Stack.Navigator>
);

export default TeamStack;
