import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { AuthStackParamList } from "../../navigation/types";
import { signup } from "../../../core/api/auth";
import { setItem, StorageKeys } from "../../../core/storage/secureStore";

type SignUpRoute = RouteProp<AuthStackParamList, "SignUp">;

const fontFamily = Platform.select({ ios: "SF Pro Text", android: "Roboto" }) ?? "System";
const controlRadius = 8;

const SignUpScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<SignUpRoute>();
  const inviteToken = route.params?.inviteToken ?? "";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("+1 ");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [requirements, setRequirements] = useState({
    length: false,
    uppercase: false,
    number: false,
    specialChar: false,
  });

  const validateEmail = (value: string) => {
    const hasAt = value.includes("@");
    const hasDotCom = value.includes(".com");
    if (!hasAt || !hasDotCom) {
      setEmailError("Email must include @ and .com");
      return false;
    }
    setEmailError("");
    return true;
  };

  const validatePhone = (value: string) => {
    const digitsOnly = value.replace(/[^\d]/g, "");
    const phoneWithoutCountry = digitsOnly.startsWith("1") ? digitsOnly.slice(1) : digitsOnly;
    if (phoneWithoutCountry.length === 10) {
      setPhoneError("");
      return true;
    }
    setPhoneError("Please enter a valid US phone number (10 digits)");
    return false;
  };

  const formatPhone = (value: string) => {
    let next = value;
    if (!next.startsWith("+1 ")) {
      next = "+1 ";
    }
    const digits = next.slice(3).replace(/[^\d]/g, "").slice(0, 10);
    let formatted = "+1 ";
    if (digits.length > 0) {
      formatted += "(";
      formatted += digits.slice(0, 3);
      if (digits.length > 3) {
        formatted += ") ";
        formatted += digits.slice(3, 6);
        if (digits.length > 6) {
          formatted += "-";
          formatted += digits.slice(6, 10);
        }
      }
    }
    setPhoneNumber(formatted);
    if (digits.length > 0) {
      validatePhone(`+1${digits}`);
    } else {
      setPhoneError("");
    }
  };

  const validatePassword = (value: string) => {
    const minLength = 8;
    const maxLength = 12;
    const hasUppercase = /[A-Z]/.test(value);
    const hasNumber = /[0-9]/.test(value);
    const hasSpecialChar = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(value);
    const lengthValid = value.length >= minLength && value.length <= maxLength;
    setRequirements({
      length: lengthValid,
      uppercase: hasUppercase,
      number: hasNumber,
      specialChar: hasSpecialChar,
    });

    if (value.length < minLength) {
      setPasswordError("Password must be at least 8 characters");
      return false;
    }
    if (value.length > maxLength) {
      setPasswordError("Password must be 12 characters or less");
      return false;
    }
    if (!hasUppercase) {
      setPasswordError("Password must contain at least 1 uppercase letter");
      return false;
    }
    if (!hasNumber) {
      setPasswordError("Password must contain at least 1 number");
      return false;
    }
    if (!hasSpecialChar) {
      setPasswordError("Password must contain at least 1 special character");
      return false;
    }
    setPasswordError("");
    return true;
  };

  const isFormValid = useMemo(() => {
    return (
      Boolean(firstName.trim()) &&
      Boolean(lastName.trim()) &&
      Boolean(email.trim()) &&
      Boolean(phoneNumber.trim()) &&
      Boolean(password)
    );
  }, [firstName, lastName, email, phoneNumber, password]);

  const handleSubmit = async () => {
    setSubmitError("");
    const isEmailValid = email ? validateEmail(email) : false;
    const isPhoneValid = phoneNumber ? validatePhone(phoneNumber) : false;
    const isPasswordValid = password ? validatePassword(password) : false;
    if (!isEmailValid || !isPhoneValid || !isPasswordValid) {
      return;
    }
    setIsLoading(true);
    try {
      const data = await signup({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phoneNumber,
        password,
        inviteToken: inviteToken || undefined,
      });
      if (!data.success) {
        setSubmitError(data.detail || "Signup failed");
        return;
      }
      if (data.user_id) {
        await setItem(StorageKeys.userId, String(data.user_id));
      }
      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      if (fullName) {
        await setItem(StorageKeys.userName, fullName);
      }
      if (data.restaurant_key) {
        await setItem(StorageKeys.restaurantKey, String(data.restaurant_key));
      }
      navigation.navigate("Login" as never);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "Network error or server is unreachable.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.card}>
        <Text style={styles.title}>Create Account</Text>
        <Text style={styles.subtitle}>Join Gratly to manage payouts and tips.</Text>

        <Text style={styles.label}>First Name</Text>
        <TextInput
          style={styles.input}
          placeholder="John"
          value={firstName}
          onChangeText={setFirstName}
        />

        <Text style={styles.label}>Last Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Doe"
          value={lastName}
          onChangeText={setLastName}
        />

        <Text style={styles.label}>Email Address</Text>
        <TextInput
          style={[styles.input, emailError ? styles.inputError : null]}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            if (value) {
              validateEmail(value);
            } else {
              setEmailError("");
            }
          }}
        />
        {emailError ? <Text style={styles.errorText}>{emailError}</Text> : null}

        <Text style={styles.label}>Phone Number</Text>
        <TextInput
          style={[styles.input, phoneError ? styles.inputError : null]}
          placeholder="+1 (555) 123-4567"
          keyboardType="phone-pad"
          value={phoneNumber}
          onChangeText={formatPhone}
        />
        {phoneError ? <Text style={styles.errorText}>{phoneError}</Text> : null}

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordField}>
          <TextInput
            style={[styles.input, styles.passwordInput, passwordError ? styles.inputError : null]}
            placeholder="••••••••"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (value) {
                validatePassword(value);
              } else {
                setPasswordError("");
              }
            }}
          />
          <Pressable
            style={styles.iconButton}
            onPress={() => setShowPassword((prev) => !prev)}
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={18}
              color="#6b7280"
            />
          </Pressable>
        </View>
        {passwordError ? <Text style={styles.errorText}>{passwordError}</Text> : null}

        <View style={styles.requirementsBox}>
          <Text style={styles.requirementsTitle}>Password must contain:</Text>
          <Text style={requirements.length ? styles.requirementGood : styles.requirementBad}>
            {requirements.length ? "✓" : "•"} 8-12 characters
          </Text>
          <Text style={requirements.uppercase ? styles.requirementGood : styles.requirementBad}>
            {requirements.uppercase ? "✓" : "•"} At least 1 uppercase letter
          </Text>
          <Text style={requirements.number ? styles.requirementGood : styles.requirementBad}>
            {requirements.number ? "✓" : "•"} At least 1 number
          </Text>
          <Text style={requirements.specialChar ? styles.requirementGood : styles.requirementBad}>
            {requirements.specialChar ? "✓" : "•"} At least 1 special character
          </Text>
        </View>

        {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

        <Pressable
          style={[styles.primaryButton, (!isFormValid || isLoading) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!isFormValid || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size={18} color="#111827" />
          ) : (
            <Text style={styles.primaryButtonText}>Create Account</Text>
          )}
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable onPress={() => navigation.navigate("Login" as never)}>
          <View style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Already have an account? Sign In</Text>
          </View>
        </Pressable>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "#f4f2ee",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    marginTop: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
    fontFamily,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 16,
    fontFamily,
  },
  label: {
    marginTop: 16,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "400",
    color: "#374151",
    letterSpacing: 0.3,
    lineHeight: 16,
    fontFamily,
  },
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: controlRadius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
    fontFamily,
  },
  inputError: {
    borderColor: "#ef4444",
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  passwordInput: {
    paddingRight: 40,
  },
  passwordField: {
    position: "relative",
  },
  iconButton: {
    position: "absolute",
    right: 10,
    top: "50%",
    transform: [{ translateY: -9 }],
    height: 18,
    width: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    marginTop: 8,
    color: "#b91c1c",
    fontSize: 12,
    lineHeight: 16,
    fontFamily,
  },
  requirementsBox: {
    marginTop: 6,
    paddingVertical: 4,
  },
  requirementsTitle: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 6,
    lineHeight: 16,
    fontFamily,
  },
  requirementGood: {
    color: "#15803d",
    fontSize: 12,
    marginTop: 0,
    lineHeight: 16,
    fontFamily,
  },
  requirementBad: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 0,
    lineHeight: 16,
    fontFamily,
  },
  primaryButton: {
    marginTop: 16,
    backgroundColor: "#cab99a",
    paddingVertical: 12,
    borderRadius: controlRadius,
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dividerRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e5e7eb",
  },
  dividerText: {
    fontSize: 12,
    color: "#6b7280",
    fontFamily,
  },
  secondaryButton: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#111827",
    borderRadius: controlRadius,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
});

export default SignUpScreen;
