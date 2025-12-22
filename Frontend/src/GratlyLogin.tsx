import React, { useState, useEffect } from 'react';
import { useNavigate } from "react-router-dom";
import gratlyLogo from './assets/gratlylogo.png';


const GratlyLogin: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
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

const handleLogin = async () => {
  setIsLoading(true);

  const res = await fetch("http://127.0.0.1:8000/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const data = await res.json();
  setIsLoading(false);

  console.log(data);
  
  if (data.success) {
    if (data.user_id) {
      localStorage.setItem("userId", String(data.user_id));
    }
    if (data.first_name || data.last_name) {
      const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim();
      if (fullName) {
        localStorage.setItem("userName", fullName);
      }
    }
    if (data.restaurant_key) {
      localStorage.setItem("restaurantKey", String(data.restaurant_key));
      if (data.restaurant_name) {
        localStorage.setItem("restaurantName", String(data.restaurant_name));
      } else {
        localStorage.removeItem("restaurantName");
      }
      navigate(`/business/${data.restaurant_key}/home`);
    } else {
      localStorage.removeItem("restaurantKey");
      localStorage.removeItem("restaurantName");
      navigate("/dashboard");
    }
  } else {
    alert("Invalid login");
  }
};

  const handleForgotPassword = (): void => {
    console.log('Forgot password clicked');
    alert('Password reset link would be sent to your email');
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
              style={{ height: '8rem' }}
            />
          ) : (
            <div style={{ height: '8rem' }} className="flex items-center justify-center">
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

          <div className="space-y-5">
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
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
              />
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
              onClick={handleLogin}
              disabled={isLoading}
              className="w-full bg-gray-900 text-white py-3 rounded-lg font-semibold hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl"
            >
              {isLoading ? 'Signing In...' : 'Sign In'}
            </button>
          </div>

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
