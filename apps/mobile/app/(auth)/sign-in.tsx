import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function SignIn() {
  const { colors, type, radius, space } = useTheme();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!email || !password) return;
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) Alert.alert("Sign-in failed", error.message);
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + space[6], paddingBottom: insets.bottom + space[4] },
        ]}
      >
        <Text
          style={[type.displaySmall, { color: colors.textPrimary, marginBottom: space[2] }]}
          accessibilityRole="header"
        >
          Lifelist
        </Text>
        <Text style={[type.paraRegular, { color: colors.textSecondary, marginBottom: space[8] }]}>
          Sign in to your bucket list
        </Text>

        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderGlass,
              borderRadius: radius.md,
              color: colors.textPrimary,
              ...type.paraRegular,
            },
          ]}
          placeholder="Email"
          placeholderTextColor={colors.textSecondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Email address"
        />

        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderGlass,
              borderRadius: radius.md,
              color: colors.textPrimary,
              ...type.paraRegular,
              marginTop: space[3],
            },
          ]}
          placeholder="Password"
          placeholderTextColor={colors.textSecondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          accessibilityLabel="Password"
        />

        <TouchableOpacity
          style={[
            styles.button,
            {
              backgroundColor: colors.accent,
              borderRadius: radius.lg,
              marginTop: space[6],
              opacity: loading ? 0.6 : 1,
            },
          ]}
          onPress={handleSignIn}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ disabled: loading, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[type.cta, { color: "#fff" }]}>Sign in</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "center",
  },
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderWidth: 1,
  },
  button: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
});
