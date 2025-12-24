import { useState } from "react";
import { api } from "../api/client";

type LoginResponse = {
  success: boolean;
  restaurant_key?: number | null;
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = async () => {
    const res = await api.post<LoginResponse>("/login", { email, password });
    if (!res.success) {
      alert("Invalid email or password.");
      return;
    }

    if (res.restaurant_key) {
      localStorage.setItem("restaurantKey", String(res.restaurant_key));
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
        <input
          className="border p-2 w-full mb-2"
          placeholder="Email"
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="border p-2 w-full mb-4"
          type="password"
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          onClick={login}
          className="bg-[#cab99a] text-black w-full p-2 rounded hover:bg-[#bfa986]"
        >
          Login
        </button>
      </div>
    </div>
  );
}
