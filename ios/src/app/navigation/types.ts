import type { NavigatorScreenParams } from "@react-navigation/native";

export type AuthStackParamList = {
  Login: undefined;
  ForgotPassword: undefined;
  ResetPassword: { token?: string } | undefined;
  SignUp: { inviteToken?: string } | undefined;
};

export type TeamStackParamList = {
  TeamList: undefined;
  EmployeeProfile: { employeeGuid: string };
};

export type SettingsStackParamList = {
  Settings: undefined;
  Billing: undefined;
  Profile: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Approvals: undefined;
  ShiftPayout: undefined;
  TeamStack: NavigatorScreenParams<TeamStackParamList>;
  Reports: undefined;
  SettingsStack: NavigatorScreenParams<SettingsStackParamList>;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};
