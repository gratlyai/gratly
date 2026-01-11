import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../providers/useAuth";
import type { RootStackParamList } from "./types";
import AuthStack from "./AuthStack";
import MainTabs from "./MainTabs";
import LoadingScreen from "../screens/LoadingScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator = () => {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {session ? (
        <Stack.Screen name="Main" component={MainTabs} />
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
};

export default RootNavigator;
