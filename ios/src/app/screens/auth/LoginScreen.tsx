import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../../providers/useAuth";

const fontFamily = Platform.select({ ios: "SF Pro Text", android: "Roboto" }) ?? "System";
const labelFontFamily = Platform.select({ ios: "SF Pro Text", android: "Roboto" }) ?? "System";

const LoginScreen = () => {
  const navigation = useNavigation();
  const { signIn, rememberedEmail, setRememberedEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRememberMe(true);
    }
  }, [rememberedEmail]);

  useEffect(() => {
    if (rememberMe) {
      if (email) {
        void setRememberedEmail(email);
      } else {
        void setRememberedEmail(null);
      }
    } else {
      void setRememberedEmail(null);
    }
  }, [email, rememberMe, setRememberedEmail]);

  const handleLogin = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await signIn(email.trim(), password, rememberMe);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.logoWrap}>
        <Image
          source={require("../../assets/gratlylogodash.png")}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Gratly logo"
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Welcome Back</Text>
        <Text style={styles.subtitle}>Sign in to continue to Gratly.</Text>

        <Text style={styles.label}>Email Address</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordField}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="••••••••"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable
            onPress={() => setShowPassword((prev) => !prev)}
            style={styles.iconButton}
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          >
            <Ionicons
              name={showPassword ? "eye-off-outline" : "eye-outline"}
              size={18}
              color="#6b7280"
            />
          </Pressable>
        </View>

        <View style={styles.rowBetween}>
          <View style={styles.rememberRow}>
            <Text style={styles.checkboxLabel}>Remember me</Text>
            <Switch
              value={rememberMe}
              onValueChange={setRememberMe}
              trackColor={{ false: "#d1d5db", true: "#e6d7b8" }}
              thumbColor={rememberMe ? "#ffffff" : "#f4f3f4"}
              style={styles.rememberSwitch}
            />
          </View>
          <Pressable onPress={() => navigation.navigate("ForgotPassword" as never)}>
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Pressable
          style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size={18} color="#111827" />
          ) : (
            <Text style={styles.primaryButtonText}>Sign In</Text>
          )}
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable onPress={() => navigation.navigate("SignUp" as never)}>
          <View style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Create New Account</Text>
          </View>
        </Pressable>
      </View>
      <Text style={styles.termsText}>
        By continuing, you agree to Gratly&apos;s Terms of Service and Privacy Policy
      </Text>
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
  },
  logoWrap: {
    alignItems: "center",
    marginBottom: 24,
  },
  logo: {
    width: 200,
    height: 100,
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
    fontWeight: "600",
    color: "#374151",
    letterSpacing: 0.3,
    lineHeight: 16,
    fontFamily: labelFontFamily,
  },
  input: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    fontWeight: "500",
    color: "#111827",
    fontFamily,
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
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rememberSwitch: {
    transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }],
  },
  checkboxLabel: {
    fontSize: 12,
    color: "#4b5563",
    lineHeight: 16,
    fontFamily,
  },
  link: {
    fontSize: 12,
    color: "#111827",
    lineHeight: 16,
    fontFamily,
  },
  errorText: {
    marginTop: 12,
    color: "#b91c1c",
    fontSize: 12,
    lineHeight: 16,
    fontFamily,
  },
  primaryButton: {
    marginTop: 16,
    backgroundColor: "#cab99a",
    paddingVertical: 12,
    borderRadius: 8,
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
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    fontFamily,
  },
  termsText: {
    marginTop: 12,
    textAlign: "center",
    fontSize: 12,
    color: "#6b7280",
    lineHeight: 16,
    fontFamily,
  },
});

export default LoginScreen;
