import { useState } from "react";

const reportOptions = [
  {
    id: "yesterday",
    label: "Yesterday",
    description: "One-day snapshot of sales, tips, and payouts.",
  },
  {
    id: "this-week",
    label: "This Week",
    description: "Week-to-date performance and payout coverage.",
  },
  {
    id: "this-month",
    label: "This Month",
    description: "Month-to-date totals with trend highlights.",
  },
  {
    id: "payroll",
    label: "Payroll",
    description: "Payroll-ready summary for the current cycle.",
  },
];

export default function Reports() {
  const [selectedReport, setSelectedReport] = useState(reportOptions[0]?.id ?? "yesterday");
  return (
    <main className="min-h-full bg-[#f4f2ee] p-8">
      <div className="w-full">
        <header>
          <h1 className="text-3xl font-semibold text-gray-900">Reports</h1>
          <p className="mt-2 text-sm text-gray-600">
            Choose a reporting window to review sales performance and payout coverage.
          </p>
        </header>

        <section className="mt-8 rounded-2xl border border-[#e4dccf] bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Report Range</h2>
          </div>
          <fieldset className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <legend className="sr-only">Select a report range</legend>
            {reportOptions.map((option) => (
              <label
                key={option.id}
                className="group relative flex cursor-pointer items-start gap-4 rounded-xl border border-[#e4dccf] bg-[#faf7f2] p-4 transition hover:border-[#cab99a]"
              >
                <input
                  type="radio"
                  name="report-range"
                  value={option.id}
                  checked={selectedReport === option.id}
                  onChange={() => setSelectedReport(option.id)}
                  className="peer sr-only"
                />
                <span className="mt-1 h-4 w-4 rounded-full border border-gray-400 bg-white shadow-inner transition peer-checked:border-[#cab99a] peer-checked:bg-[#cab99a]" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-900">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs text-gray-600">
                    {option.description}
                  </span>
                </span>
                <span className="pointer-events-none absolute inset-0 rounded-xl border-2 border-transparent transition group-hover:border-[#cab99a]/40 peer-checked:border-[#cab99a]" />
              </label>
            ))}
          </fieldset>
        </section>

      </div>
    </main>
  );
}
