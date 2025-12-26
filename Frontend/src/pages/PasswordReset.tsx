import React, { useState } from "react";
import gratlyLogo from "../assets/gratlylogodash.png";
import { api } from "../api/client";

const PasswordReset: React.FC = () => {
  const [email, setEmail] = useState<string>("");
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSending(true);
    try {
      await api.post("/password-reset/request", { email });
      setSubmitted(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send reset email.";
      setError(message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center p-4"
      style={{ backgroundColor: "#f4f2ee", minHeight: "100vh", width: "100vw" }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <img
            src={gratlyLogo}
            alt="Gratly Logo"
            className="mx-auto"
            style={{ width: "254px", height: "130px" }}
          />
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-2 text-center">
            Reset Password
          </h2>
          <p className="text-sm text-gray-600 mb-6 text-center">
            Enter your email to receive a password reset link.
          </p>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (submitted) {
                    setSubmitted(false);
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                placeholder="you@example.com"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSending}
              className="w-full bg-[#cab99a] text-black py-3 rounded-lg font-semibold hover:bg-[#bfa986] transition-all shadow-lg hover:shadow-xl"
            >
              {isSending ? "Sending..." : "Send Reset Link"}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          ) : null}
          {submitted ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
              If an account exists for {email}, a reset link has been sent.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PasswordReset;
