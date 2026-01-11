import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AuthStackParamList } from "./types";
import LoginScreen from "../screens/auth/LoginScreen";
import SignUpScreen from "../screens/auth/SignUpScreen";
import ForgotPasswordScreen from "../screens/auth/ForgotPasswordScreen";
import ResetPasswordScreen from "../screens/auth/ResetPasswordScreen";

const Stack = createNativeStackNavigator<AuthStackParamList>();

const AuthStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
    <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Reset Password" }} />
    <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: "Set New Password" }} />
    <Stack.Screen name="SignUp" component={SignUpScreen} options={{ headerShown: false }} />
  </Stack.Navigator>
);

export default AuthStack;
