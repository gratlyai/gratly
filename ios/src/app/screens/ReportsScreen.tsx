import React from "react";
import PlaceholderScreen from "./placeholders/PlaceholderScreen";
import AppShell from "../components/AppShell";

const ReportsScreen = () => (
  <AppShell>
    <PlaceholderScreen
      title="Reports"
      description="Placeholder for Reports.tsx."
      todos={[
        "Report selector (Yesterday, This Week, This Month, Payroll)",
        "Summary metrics + payout coverage cards",
        "Payroll date range picker and export menu",
        "Employee payout totals list",
        "Schedule detail drawer for report rows",
      ]}
      next={{ label: "Go to Settings", screen: "SettingsStack" }}
    />
  </AppShell>
);

export default ReportsScreen;
