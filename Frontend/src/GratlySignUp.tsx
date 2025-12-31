import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from "react-router-dom";
import gratlyLogo from './assets/gratlylogodash.png';


const GratlySignUp: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [firstName, setFirstName] = useState<string>('');
  const [lastName, setLastName] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('+1 ');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [logoData, setLogoData] = useState<string>('');
  const [passwordError, setPasswordError] = useState<string>('');
  const [passwordRequirements, setPasswordRequirements] = useState({
    length: false,
    uppercase: false,
    number: false,
    specialChar: false
  });
  const [emailError, setEmailError] = useState<string>('');
  const [phoneError, setPhoneError] = useState<string>('');
  const [inviteToken, setInviteToken] = useState<string>('');

  const validateEmail = (email: string): boolean => {
    const hasAt = email.includes('@');
    const hasDotCom = email.includes('.com');
    
    if (!hasAt || !hasDotCom) {
      setEmailError('Email must include @ and .com');
      return false;
    }
    
    setEmailError('');
    return true;
  };

  const validatePhone = (phone: string): boolean => {
    // Remove all non-digit characters except the +1 prefix
    const digitsOnly = phone.replace(/[^\d]/g, '');
    
    // Should have exactly 10 digits after the country code
    const phoneWithoutCountryCode = digitsOnly.startsWith('1') ? digitsOnly.slice(1) : digitsOnly;
    
    if (phoneWithoutCountryCode.length === 10) {
      setPhoneError('');
      return true;
    }
    
    setPhoneError('Please enter a valid US phone number (10 digits)');
    return false;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    
    // If user tries to delete the +1, prevent it
    if (!value.startsWith('+1 ')) {
      value = '+1 ';
    }
    
    // Only allow the part after +1 to be modified
    const phoneDigits = value.slice(3).replace(/[^\d]/g, '');
    
    // Restrict to 10 digits max
    const limitedDigits = phoneDigits.slice(0, 10);
    
    // Format the phone number as (XXX) XXX-XXXX
    let formattedPhone = '+1 ';
    if (limitedDigits.length > 0) {
      formattedPhone += '(';
      formattedPhone += limitedDigits.slice(0, 3);
      if (limitedDigits.length >= 3) {
        formattedPhone += ') ';
        formattedPhone += limitedDigits.slice(3, 6);
        if (limitedDigits.length >= 6) {
          formattedPhone += '-';
          formattedPhone += limitedDigits.slice(6, 10);
        }
      }
    }
    
    setPhoneNumber(formattedPhone);
    
    if (limitedDigits) {
      validatePhone('+1' + limitedDigits);
    } else {
      setPhoneError('');
    }
  };

  const validatePassword = (pwd: string): boolean => {
    const minLength = 8;
    const maxLength = 12;
    const hasUpperCase = /[A-Z]/.test(pwd);
    const hasNumber = /[0-9]/.test(pwd);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd);
    const lengthValid = pwd.length >= minLength && pwd.length <= maxLength;

    setPasswordRequirements({
      length: lengthValid,
      uppercase: hasUpperCase,
      number: hasNumber,
      specialChar: hasSpecialChar
    });

    if (pwd.length < minLength) {
      setPasswordError('Password must be at least 8 characters');
      return false;
    }
    if (pwd.length > maxLength) {
      setPasswordError('Password must be 12 characters or less');
      return false;
    }
    if (!hasUpperCase) {
      setPasswordError('Password must contain at least 1 uppercase letter');
      return false;
    }
    if (!hasNumber) {
      setPasswordError('Password must contain at least 1 number');
      return false;
    }
    if (!hasSpecialChar) {
      setPasswordError('Password must contain at least 1 special character');
      return false;
    }

    setPasswordError('');
    return true;
  };

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
const navigate = useNavigate();  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    if (token) {
      setInviteToken(token);
    }
  }, [location.search]);

const handleSignUp = async () => {
  setIsLoading(true);
  try {
    const payload = {
        firstName,
        lastName,
        email,
        phoneNumber,
        password,
        ...(inviteToken ? { inviteToken } : {}),
      };
      const res = await fetch("http://127.0.0.1:8000/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    let data;
    try {
      data = await res.json();
    } catch (jsonError) {
      console.error("Failed to parse JSON response:", jsonError);
      alert("An unexpected error occurred. Please try again later.");
      setIsLoading(false);
      return;
    }

    if (data.success) {
      if (data.user_id) {
        localStorage.setItem("userId", String(data.user_id));
      }
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName) {
        localStorage.setItem("userName", fullName);
      }
      if (data.restaurant_key) {
        localStorage.setItem("restaurantKey", String(data.restaurant_key));
      }
      navigate("/login");
    } else {
      alert(data.detail || "Signup failed");
    }
  } catch (error) {
    console.error("Signup request failed:", error);
    alert("Network error or server is unreachable. Please try again.");
  } finally {
    setIsLoading(false);
  }
};

  

  const handleBackToLogin = (): void => {
    window.location.href = '/';
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
              <div className="gratlylogo">
                 <img src={gratlyLogo} alt="Gratly Logo" className="gratlylogomain"></img>
              </div>
            </div>
          )}
        </div>

        {/* Sign Up Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            Create Account
          </h2>

          <div className="space-y-5">
            {/* First Name Input */}
            <div>
              <label 
                htmlFor="firstName" 
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                First Name
              </label>
              <input
                id="firstName"
                type="text"
                value={firstName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFirstName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                placeholder="John"
              />
            </div>

            {/* Last Name Input */}
            <div>
              <label 
                htmlFor="lastName" 
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Last Name
              </label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                placeholder="Doe"
              />
            </div>

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
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setEmail(e.target.value);
                  if (e.target.value) {
                    validateEmail(e.target.value);
                  } else {
                    setEmailError('');
                  }
                }}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all ${
                  emailError ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="you@example.com"
              />
              {emailError && (
                <p className="text-red-600 text-xs mt-2">{emailError}</p>
              )}
            </div>

            {/* Phone Number Input */}
            <div>
              <label 
                htmlFor="phoneNumber" 
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Phone Number
              </label>
              <input
                id="phoneNumber"
                type="tel"
                value={phoneNumber}
                onChange={handlePhoneChange}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all ${
                  phoneError ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="+1 (555) 123-4567"
              />
              {phoneError && (
                <p className="text-red-600 text-xs mt-2">{phoneError}</p>
              )}
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
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setPassword(e.target.value);
                    if (e.target.value) {
                      validatePassword(e.target.value);
                    } else {
                      setPasswordError('');
                    }
                  }}
                  className={`w-full px-4 py-3 pr-12 border rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all ${
                    passwordError ? 'border-red-500' : 'border-gray-300'
                  }`}
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
              {passwordError && (
                <p className="text-red-600 text-xs mt-2">{passwordError}</p>
              )}
              <div className="mt-2 text-xs">
                <p className="text-gray-600 mb-1">Password must contain:</p>
                <ul className="space-y-1">
                  <li className={`flex items-center ${passwordRequirements.length ? 'text-green-600' : 'text-gray-600'}`}>
                    <span className="mr-2">{passwordRequirements.length ? '✓' : '•'}</span>
                    8-12 characters
                  </li>
                  <li className={`flex items-center ${passwordRequirements.uppercase ? 'text-green-600' : 'text-gray-600'}`}>
                    <span className="mr-2">{passwordRequirements.uppercase ? '✓' : '•'}</span>
                    At least 1 uppercase letter
                  </li>
                  <li className={`flex items-center ${passwordRequirements.number ? 'text-green-600' : 'text-gray-600'}`}>
                    <span className="mr-2">{passwordRequirements.number ? '✓' : '•'}</span>
                    At least 1 number
                  </li>
                  <li className={`flex items-center ${passwordRequirements.specialChar ? 'text-green-600' : 'text-gray-600'}`}>
                    <span className="mr-2">{passwordRequirements.specialChar ? '✓' : '•'}</span>
                    At least 1 special character
                  </li>
                </ul>
              </div>
            </div>

            {/* Sign Up Button */}
            <button
              onClick={handleSignUp}
              disabled={isLoading}
              className="w-full bg-[#cab99a] text-black py-3 rounded-lg font-semibold hover:bg-[#bfa986] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl mt-2"
            >
              {isLoading ? 'Creating Account...' : 'Create Account'}
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

          {/* Back to Login Button */}
          <button
            type="button"
            onClick={handleBackToLogin}
            className="w-full bg-white text-gray-900 py-3 rounded-lg font-semibold border-2 border-gray-900 hover:bg-gray-50 transition-all shadow-md hover:shadow-lg"
          >
            Already have an account? Sign In
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

export default GratlySignUp;
