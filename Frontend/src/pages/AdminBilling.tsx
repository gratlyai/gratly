import React, { useEffect, useState } from "react";
import axios from "axios";

interface Job {
  id: string;
  name: string;
  next_run: string | null;
}

export default function AdminBilling() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);

  const userId = Number(localStorage.getItem("userId") || "");

  useEffect(() => {
    const loadJobs = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await axios.get(
          `/api/admin/jobs/status?user_id=${userId}`
        );
        setJobs(response.data.jobs || []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load job status"
        );
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      loadJobs();
      // Refresh every 30 seconds
      const interval = setInterval(loadJobs, 30000);
      return () => clearInterval(interval);
    }
  }, [userId]);

  const triggerJob = async (jobName: string) => {
    try {
      setTriggering(jobName);
      setTriggerResult(null);
      await axios.post(
        `/api/admin/jobs/trigger/${jobName}?user_id=${userId}`
      );
      setTriggerResult(`✓ Job "${jobName}" triggered successfully`);
      // Refresh job status
      const response = await axios.get(
        `/api/admin/jobs/status?user_id=${userId}`
      );
      setJobs(response.data.jobs || []);
    } catch (err) {
      setTriggerResult(
        `✗ Failed to trigger job: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
    } finally {
      setTriggering(null);
    }
  };

  const formatNextRun = (isoString: string | null) => {
    if (!isoString) return "Not scheduled";
    try {
      const date = new Date(isoString);
      return date.toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Billing Management</h1>
          <p className="mt-2 text-gray-600">
            Monitor and manually trigger payment processing jobs
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">
              <strong>Error:</strong> {error}
            </p>
          </div>
        )}

        {triggerResult && (
          <div
            className={`mb-6 rounded-lg border p-4 ${
              triggerResult.startsWith("✓")
                ? "border-emerald-200 bg-emerald-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`text-sm ${
                triggerResult.startsWith("✓")
                  ? "text-emerald-700"
                  : "text-red-700"
              }`}
            >
              {triggerResult}
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-6 text-xl font-semibold text-gray-900">
            Scheduled Jobs
          </h2>

          {loading ? (
            <div className="py-12 text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900"></div>
              <p className="mt-4 text-gray-600">Loading job status...</p>
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-gray-500">No jobs scheduled</p>
            </div>
          ) : (
            <div className="space-y-4">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{job.name}</h3>
                    <p className="mt-1 text-sm text-gray-600">
                      Job ID: <code className="text-xs">{job.id}</code>
                    </p>
                    <p className="mt-2 text-sm text-gray-500">
                      <strong>Next run:</strong> {formatNextRun(job.next_run)}
                    </p>
                  </div>

                  <button
                    onClick={() => triggerJob(job.id)}
                    disabled={triggering === job.id}
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {triggering === job.id ? (
                      <>
                        <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                        Running...
                      </>
                    ) : (
                      "Trigger Now"
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            Job Descriptions
          </h2>
          <div className="space-y-4 text-sm text-gray-600">
            <div>
              <p className="font-semibold text-gray-900">
                1. Generate Monthly Invoices
              </p>
              <p className="mt-1">
                Creates monthly billing invoices for all restaurants and
                initiates payment collection. Runs on the 1st of each month at
                2 AM (restaurant local time).
              </p>
            </div>

            <div className="border-t pt-4">
              <p className="font-semibold text-gray-900">
                2. Retry Failed Collections
              </p>
              <p className="mt-1">
                Retries invoices that failed to collect on the first attempt.
                Runs daily at 10 AM with 6-hour retry intervals between
                failures.
              </p>
            </div>

            <div className="border-t pt-4">
              <p className="font-semibold text-gray-900">
                3. Process Restaurant Debits
              </p>
              <p className="mt-1">
                Aggregates approved payouts and creates a single nightly ACH
                debit from each restaurant's bank account. Runs daily at 3 AM
                (restaurant local time).
              </p>
            </div>

            <div className="border-t pt-4">
              <p className="font-semibold text-gray-900">
                4. Disburse Employee Payouts
              </p>
              <p className="mt-1">
                Creates individual payout transfers to employee bank accounts or
                debit cards. Runs daily at 4 AM (restaurant local time) after
                restaurant debits complete.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
