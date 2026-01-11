import React from "react";
import PlaceholderScreen from "../placeholders/PlaceholderScreen";

const ResetPasswordScreen = () => (
  <PlaceholderScreen
    title="Set New Password"
    description="Placeholder for the PasswordResetForm.tsx flow."
    todos={[
      "Token capture from deep link/route params",
      "New password input with show/hide",
      "Confirm password input with show/hide",
      "Validation + mismatch error state",
      "Submit button (POST /password-reset/confirm)",
      "Success confirmation message",
    ]}
    next={{ label: "Back to Login", screen: "Login" }}
  />
);

export default ResetPasswordScreen;
