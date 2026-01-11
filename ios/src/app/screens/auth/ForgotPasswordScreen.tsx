import React from "react";
import PlaceholderScreen from "../placeholders/PlaceholderScreen";

const ForgotPasswordScreen = () => (
  <PlaceholderScreen
    title="Reset Password"
    description="Placeholder for the PasswordReset.tsx flow."
    todos={[
      "Logo header",
      "Email input",
      "Send reset link button (POST /password-reset/request)",
      "Loading state + error banner",
      "Success confirmation message",
    ]}
    next={{ label: "Go to Set New Password", screen: "ResetPassword" }}
  />
);

export default ForgotPasswordScreen;
