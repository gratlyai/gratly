import { useState } from "react";
import { api } from "../api/client";

type LoginResponse = {
  success: boolean;
  restaurant_key?: number | null;
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const login = async () => {
    const res = await api.post<LoginResponse>("/login", { email, password });
    if (!res.success) {
      alert("Invalid email or password.");
      return;
    }

    if (res.restaurant_key) {
      localStorage.setItem("restaurantKey", String(res.restaurant_key));
    }

    const redirectParam = new URLSearchParams(window.location.search).get("redirect");
    if (redirectParam && redirectParam.startsWith("/")) {
      window.location.href = redirectParam;
      return;
    }

    const restaurantKey = res.restaurant_key ?? null;
    const nextPath = restaurantKey
      ? `/business/${restaurantKey}/home`
      : "/login";
    window.location.href = nextPath;
  };

  return (
    <div className="h-screen flex items-center justify-center">
      <div className="bg-white p-6 rounded shadow w-96">
        <h1 className="text-xl mb-4">Login</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            login();
          }}
        >
          <input
            className="border p-2 w-full mb-2"
            placeholder="Email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <div className="relative mb-4">
            <input
              className="border p-2 w-full pr-12"
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              onChange={(e) => setPassword(e.target.value)}
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
          <button
            type="submit"
            className="bg-[#cab99a] text-black w-full p-2 rounded hover:bg-[#bfa986]"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
