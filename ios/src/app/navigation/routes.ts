export const webToMobileRoutes = {
  // Auth flow (web paths: /, /login)
  login: {
    web: ["/", "/login"],
    mobile: "Auth/Login",
  },
  forgotPassword: {
    web: ["/forgot-password"],
    mobile: "Auth/ForgotPassword",
  },
  resetPassword: {
    web: ["/reset-password"],
    mobile: "Auth/ResetPassword",
  },
  signUp: {
    web: ["/signup"],
    mobile: "Auth/SignUp",
  },

  // Business routes (web path: /business/:restaurantKey/*)
  businessHome: {
    web: ["/business/:restaurantKey/home"],
    mobile: "Main/Home",
  },
  businessApprovals: {
    web: ["/business/:restaurantKey/approvals"],
    mobile: "Main/Approvals",
  },
  businessShiftPayout: {
    web: ["/business/:restaurantKey/shift-payout"],
    mobile: "Main/ShiftPayout",
  },
  businessTeam: {
    web: ["/business/:restaurantKey/team"],
    mobile: "Main/TeamStack/TeamList",
  },
  businessEmployeeProfile: {
    web: ["/business/:restaurantKey/team/:employeeGuid"],
    mobile: "Main/TeamStack/EmployeeProfile",
  },
  businessReports: {
    web: ["/business/:restaurantKey/reports"],
    mobile: "Main/Reports",
  },
  businessBilling: {
    web: ["/business/:restaurantKey/billing"],
    mobile: "Main/SettingsStack/Billing",
  },
  businessSettings: {
    web: ["/business/:restaurantKey/settings"],
    mobile: "Main/SettingsStack/Settings",
  },
  businessProfile: {
    web: ["/business/:restaurantKey/profile"],
    mobile: "Main/SettingsStack/Profile",
  },

  // Employee routes (web path: /employees/:employeeId/*)
  employeeHome: {
    web: ["/employees/:employeeId/home"],
    mobile: "Main/Home",
  },
  employeeApprovals: {
    web: ["/employees/:employeeId/approvals"],
    mobile: "Main/Approvals",
  },
  employeeShiftPayout: {
    web: ["/employees/:employeeId/shift-payout"],
    mobile: "Main/ShiftPayout",
  },
  employeeTeam: {
    web: ["/employees/:employeeId/team"],
    mobile: "Main/TeamStack/TeamList",
  },
  employeeEmployeeProfile: {
    web: ["/employees/:employeeId/team/:employeeGuid"],
    mobile: "Main/TeamStack/EmployeeProfile",
  },
  employeeReports: {
    web: ["/employees/:employeeId/reports"],
    mobile: "Main/Reports",
  },
  employeeSettings: {
    web: ["/employees/:employeeId/settings"],
    mobile: "Main/SettingsStack/Settings",
  },
  employeeProfile: {
    web: ["/employees/:employeeId/profile"],
    mobile: "Main/SettingsStack/Profile",
  },
};
