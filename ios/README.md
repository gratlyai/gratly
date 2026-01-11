# Gratly Mobile (Expo)

## Setup
1. Install dependencies:
   - `npm install`
   - (Optional) `npx expo install` to align Expo package versions
2. Create a `.env` file at `ios/.env`:
   - Copy from `.env.example` and set `EXPO_PUBLIC_API_BASE_URL`.

## Run on iOS Simulator
- `npm run ios`

## Environment Variables
- `EXPO_PUBLIC_API_BASE_URL`: Base URL for the existing backend API.

## Push Notifications
- Permission is requested after login and can be re-triggered from the Settings tab.
- Registration call: `POST /devices/register` with `{ platform, pushToken, appVersion }`.
- Check Metro logs for success/failure messages after login or tapping “Enable Push Notifications”.

## Web → Mobile Route Mapping
| Web route | Mobile screen | Status |
| --- | --- | --- |
| `/` | `Auth/Login` | Implemented |
| `/login` | `Auth/Login` | Implemented |
| `/forgot-password` | `Auth/ForgotPassword` | Placeholder |
| `/reset-password` | `Auth/ResetPassword` | Placeholder |
| `/signup` | `Auth/SignUp` | Placeholder |
| `/business/:restaurantKey/home` | `Main/Home` | Implemented |
| `/business/:restaurantKey/approvals` | `Main/Approvals` | Placeholder |
| `/business/:restaurantKey/shift-payout` | `Main/ShiftPayout` | Placeholder |
| `/business/:restaurantKey/team` | `Main/TeamStack/TeamList` | Implemented |
| `/business/:restaurantKey/team/:employeeGuid` | `Main/TeamStack/EmployeeProfile` | Implemented |
| `/business/:restaurantKey/reports` | `Main/Reports` | Placeholder |
| `/business/:restaurantKey/billing` | `Main/SettingsStack/Billing` | Placeholder |
| `/business/:restaurantKey/settings` | `Main/SettingsStack/Settings` | Placeholder |
| `/business/:restaurantKey/profile` | `Main/SettingsStack/Profile` | Placeholder |
| `/employees/:employeeId/home` | `Main/Home` | Implemented |
| `/employees/:employeeId/approvals` | `Main/Approvals` | Placeholder |
| `/employees/:employeeId/shift-payout` | `Main/ShiftPayout` | Placeholder |
| `/employees/:employeeId/team` | `Main/TeamStack/TeamList` | Implemented |
| `/employees/:employeeId/team/:employeeGuid` | `Main/TeamStack/EmployeeProfile` | Implemented |
| `/employees/:employeeId/reports` | `Main/Reports` | Placeholder |
| `/employees/:employeeId/settings` | `Main/SettingsStack/Settings` | Placeholder |
| `/employees/:employeeId/profile` | `Main/SettingsStack/Profile` | Placeholder |
