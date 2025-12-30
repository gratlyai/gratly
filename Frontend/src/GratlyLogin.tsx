import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from "react-router-dom";
import gratlyLogo from './assets/gratlylogodash.png';
import { fetchUserPermissions } from "./api/permissions";
import { getStoredPermissions } from "./auth/permissions";


const GratlyLogin: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [rememberMe, setRememberMe] = useState<boolean>(false);
  const [logoData, setLogoData] = useState<string>('');

  useEffect(() => {
    const loadLogo = async (): Promise<void> => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await (window as any).fs.readFile('image.png');
        const blob = new Blob([data], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        setLogoData(url);
      } catch (error) {
        console.error('Error loading logo:', error);
      }
    };
    loadLogo();
  }, []);

  useEffect(() => {
    const savedEmail = localStorage.getItem('rememberedEmail');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  useEffect(() => {
    if (rememberMe) {
      if (email) {
        localStorage.setItem('rememberedEmail', email);
      }
    } else {
      localStorage.removeItem('rememberedEmail');
    }
  }, [rememberMe, email]);

const navigate = useNavigate();
const location = useLocation();

const getRedirectTarget = (): string | null => {
  const redirectParam = new URLSearchParams(location.search).get("redirect");
  if (redirectParam && redirectParam.startsWith("/")) {
    return redirectParam;
  }
  return null;
};

const handleLogin = async () => {
  setIsLoading(true);
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    const res = await fetch("http://127.0.0.1:8000/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.detail || "Login request failed.");
    }

    console.log(data);

    if (data.success) {
      if (data.user_id) {
        localStorage.setItem("userId", String(data.user_id));
      }
      const fullName = `${data.first_name || ""} ${data.last_name || ""}`.trim();
      if (fullName) {
        localStorage.setItem("userName", fullName);
      } else {
        localStorage.removeItem("userName");
      }
      if (data.restaurant_key) {
        localStorage.setItem("restaurantKey", String(data.restaurant_key));
        if (data.restaurant_name) {
          localStorage.setItem("restaurantName", String(data.restaurant_name));
        } else {
          localStorage.removeItem("restaurantName");
        }
      }
      const redirectTarget = getRedirectTarget();
      if (redirectTarget) {
        navigate(redirectTarget);
        return;
      }

      const employeeId = data.user_id ? String(data.user_id) : "";
      let permissions = getStoredPermissions(employeeId);
      if (data.user_id) {
        try {
          permissions = await fetchUserPermissions(data.user_id);
          localStorage.setItem(`employeePermissions:${data.user_id}`, JSON.stringify(permissions));
        } catch (error) {
          console.warn("Failed to refresh permissions:", error);
        }
      }
      const isBusinessUser =
        permissions.adminAccess ||
        permissions.managerAccess ||
        permissions.createPayoutSchedules ||
        permissions.approvePayouts ||
        permissions.manageTeam;
      if (data.restaurant_key && isBusinessUser) {
        navigate(`/business/${data.restaurant_key}/home`);
      } else if (employeeId) {
        navigate(`/employees/${employeeId}/home`);
      } else if (data.restaurant_key) {
        navigate(`/business/${data.restaurant_key}/home`);
      } else {
        navigate("/login");
      }
    } else {
      alert("Invalid login");
    }
  } catch (error) {
    console.error("Login failed:", error);
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "Login timed out. Make sure the backend server is running."
        : "Login failed. Check your credentials and server connection.";
    alert(message);
  } finally {
    setIsLoading(false);
  }
};

  const handleForgotPassword = (): void => {
    navigate("/forgot-password");
  };

  const handleCreateAccount = (): void => {
    window.location.href = '/signup';
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ backgroundColor: '#f4f2ee', minHeight: '100vh', width: '100vw' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          {logoData ? (
            <img 
              src={logoData}
              alt="Gratly Logo" 
              className="mx-auto"
              style={{ width: '254px', height: '130px' }}
            />
          ) : (
            <div style={{ width: '254px', height: '130px' }} className="mx-auto flex items-center justify-center">
              <div className="GratlyLogo">
                <img src={gratlyLogo} alt="Gratly Logo" className="gratlylogomain"></img>
              </div>
            </div>
          )}
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            Welcome Back
          </h2>

          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              handleLogin();
            }}
          >
            {/* Email Input */}
            <div>
              <label 
                htmlFor="email" 
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                placeholder="you@example.com"
              />
            </div>

            {/* Password Input */}
            <div>
              <label 
                htmlFor="password" 
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800 text-sm font-medium"
                >
                  {showPassword ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2.1 12s3.6-6 9.9-6 9.9 6 9.9 6-3.6 6-9.9 6-9.9-6-9.9-6Z" />
                      <path d="M9.9 12a2.1 2.1 0 1 0 4.2 0 2.1 2.1 0 0 0-4.2 0Z" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 3l18 18" />
                      <path d="M9.8 9.8a2.1 2.1 0 0 0 2.9 2.9" />
                      <path d="M6.2 6.2C4.2 7.6 2.7 9.6 2.1 12c1.4 3.5 5 6 9.9 6 1.6 0 3-.3 4.3-.9" />
                      <path d="M14.1 5.4c2.8.6 5.1 2.6 6.2 5.6-.6 1.4-1.5 2.6-2.7 3.6" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              {/* Remember Me */}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                />
                Remember me
              </label>

              {/* Forgot Password Link */}
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-sm text-gray-600 hover:text-gray-900 font-medium transition-colors bg-transparent p-0"
              >
                Forgot Password?
              </button>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-[#cab99a] text-black py-3 rounded-lg font-semibold hover:bg-[#bfa986] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
            >
              {isLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white text-gray-500">or</span>
            </div>
          </div>

          {/* Create Account Button */}
          <button
            type="button"
            onClick={handleCreateAccount}
            className="w-full bg-white text-gray-900 py-3 rounded-lg font-semibold border-2 border-gray-900 hover:bg-gray-50 transition-all shadow-md hover:shadow-lg"
          >
            Create New Account
          </button>
        </div>

        {/* Footer Text */}
        <p className="text-center text-sm text-gray-600 mt-6">
          By continuing, you agree to Gratly's Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  );
};

export default GratlyLogin;
