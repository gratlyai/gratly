import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  startRestaurantOnboarding,
  startEmployeeOnboarding,
  fetchRestaurantConnection,
  fetchEmployeeConnection,
  type MoovConnection,
} from "../api/moov";

export default function MoovOnboarding() {
  const { restaurantKey } = useParams();
  const [activeTab, setActiveTab] = useState<"restaurant" | "employee">(
    "restaurant"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restaurantConnection, setRestaurantConnection] =
    useState<MoovConnection | null>(null);
  const [employeeConnection, setEmployeeConnection] =
    useState<MoovConnection | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(true);

  const restaurantId = restaurantKey ? Number(restaurantKey) : null;
  const userId = Number(localStorage.getItem("userId") || "");

  // Load connection status
  useEffect(() => {
    const loadConnections = async () => {
      try {
        setLoadingConnection(true);
        if (restaurantId) {
          const resConn = await fetchRestaurantConnection(restaurantId);
          setRestaurantConnection(resConn);
        }
        if (userId) {
          const empConn = await fetchEmployeeConnection(userId);
          setEmployeeConnection(empConn);
        }
      } catch (err) {
        console.error("Failed to load connection status:", err);
      } finally {
        setLoadingConnection(false);
      }
    };

    loadConnections();
  }, [restaurantId, userId]);

  const handleRestaurantOnboarding = async () => {
    if (!restaurantId) {
      setError("Restaurant ID is required");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const result = await startRestaurantOnboarding(restaurantId);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
      } else {
        setError("No onboarding URL returned");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start onboarding"
      );
      setLoading(false);
    }
  };

  const handleEmployeeOnboarding = async () => {
    if (!userId) {
      setError("User ID is required");
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const result = await startEmployeeOnboarding(userId);
      if (result.redirect_url) {
        window.location.href = result.redirect_url;
      } else {
        setError("No onboarding URL returned");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start onboarding"
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Moov Account Setup
          </h1>
          <p className="mt-2 text-gray-600">
            Complete identity verification and link payment methods
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">
              <strong>Error:</strong> {error}
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          {/* Tab Navigation */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab("restaurant")}
              className={`flex-1 px-6 py-4 text-center font-semibold transition ${
                activeTab === "restaurant"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Restaurant Setup
            </button>
            <button
              onClick={() => setActiveTab("employee")}
              className={`flex-1 px-6 py-4 text-center font-semibold transition ${
                activeTab === "employee"
                  ? "border-b-2 border-blue-600 text-blue-600"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              Employee Setup
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {loadingConnection ? (
              <div className="py-12 text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-gray-900"></div>
                <p className="mt-4 text-gray-600">Loading setup status...</p>
              </div>
            ) : activeTab === "restaurant" ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Restaurant Moov Account
                  </h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Set up your restaurant's Moov account to accept payments and
                    manage payouts.
                  </p>
                </div>

                {restaurantConnection?.connected ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-semibold text-emerald-900">
                      ✓ Account Connected
                    </p>
                    <p className="mt-2 text-sm text-emerald-700">
                      Moov Account ID:{" "}
                      <code className="break-all">
                        {restaurantConnection.moov_account_id}
                      </code>
                    </p>
                    <p className="mt-1 text-sm text-emerald-700">
                      Status: {restaurantConnection.onboarding_status}
                    </p>
                    {restaurantConnection.kyb_status && (
                      <p className="mt-1 text-sm text-emerald-700">
                        KYB: {restaurantConnection.kyb_status}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg bg-blue-50 p-4">
                      <p className="text-sm text-gray-700">
                        You'll be guided through Moov's hosted onboarding to:
                      </p>
                      <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-gray-700">
                        <li>Verify business information (KYB)</li>
                        <li>Link a verified bank account</li>
                        <li>Add optional payment methods (card)</li>
                      </ul>
                    </div>

                    <button
                      onClick={handleRestaurantOnboarding}
                      disabled={loading || !restaurantId}
                      className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "Starting..." : "Start Restaurant Onboarding"}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    Employee Moov Account
                  </h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Set up your Moov account to receive instant payouts from
                    tips and shifts.
                  </p>
                </div>

                {employeeConnection?.connected ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="text-sm font-semibold text-emerald-900">
                      ✓ Account Connected
                    </p>
                    <p className="mt-2 text-sm text-emerald-700">
                      Moov Account ID:{" "}
                      <code className="break-all">
                        {employeeConnection.moov_account_id}
                      </code>
                    </p>
                    <p className="mt-1 text-sm text-emerald-700">
                      Status: {employeeConnection.onboarding_status}
                    </p>
                    {employeeConnection.kyc_status && (
                      <p className="mt-1 text-sm text-emerald-700">
                        KYC: {employeeConnection.kyc_status}
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg bg-blue-50 p-4">
                      <p className="text-sm text-gray-700">
                        You'll be guided through Moov's hosted onboarding to:
                      </p>
                      <ul className="mt-3 list-inside list-disc space-y-2 text-sm text-gray-700">
                        <li>Verify your identity (KYC)</li>
                        <li>Link a bank account (for instant payouts)</li>
                        <li>Add optional debit card for same-day deposits</li>
                      </ul>
                    </div>

                    <button
                      onClick={handleEmployeeOnboarding}
                      disabled={loading || !userId}
                      className="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loading ? "Starting..." : "Start Employee Onboarding"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            What Happens Next?
          </h2>
          <div className="space-y-4 text-sm text-gray-600">
            <div>
              <p className="font-semibold text-gray-900">After Setup</p>
              <p>
                Once your account is verified, you'll be able to receive instant
                payouts and manage your payment methods.
              </p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Verification Timeline</p>
              <p>
                Most accounts are verified immediately. Some require 1-2 business
                days for manual review.
              </p>
            </div>
            <div>
              <p className="font-semibold text-gray-900">Support</p>
              <p>
                Questions? Contact support@gratly.com or visit the Moov docs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
