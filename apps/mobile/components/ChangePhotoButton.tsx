import { setItemImage } from "@/lib/api/items";
import { useAuth } from "@/lib/auth";
import {
  MediaPermissionError,
  MediaValidationError,
  deleteItemImageObject,
  pickImage,
  uploadItemImage,
} from "@/lib/media/uploadItemImage";
import { useTheme } from "@/lib/useTheme";
import { useItemsStore } from "@/store/items";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export function ChangePhotoButton({ itemId }: { itemId: string }) {
  const { colors, radius } = useTheme();
  const { session } = useAuth();
  const upsert = useItemsStore((state) => state.upsert);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPress() {
    if (!session || busy) return;

    setBusy(true);
    setError(null);
    let uploadedPath: string | null = null;

    try {
      const asset = await pickImage();
      if (!asset) return;

      const { path } = await uploadItemImage(session.user.id, itemId, asset);
      uploadedPath = path;

      const updated = await setItemImage(itemId, path);
      upsert(updated);
      uploadedPath = null;
    } catch (err) {
      if (uploadedPath) {
        await deleteItemImageObject(uploadedPath).catch(() => {});
      }

      if (err instanceof MediaPermissionError) {
        setError("Photo access denied. Enable it in Settings, then retry.");
      } else if (err instanceof MediaValidationError) {
        setError(err.message);
      } else {
        setError("Couldn't update the photo. Tap to retry.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress}
        disabled={busy || !session}
        accessibilityRole="button"
        accessibilityLabel={error ? "Retry changing photo" : "Change photo"}
        style={[
          styles.button,
          {
            borderColor: error ? colors.danger : colors.accent,
            borderRadius: radius.md,
            opacity: busy || !session ? 0.6 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={[styles.label, { color: error ? colors.danger : colors.accent }]}>
            {error ? "Retry photo" : "Change photo"}
          </Text>
        )}
      </Pressable>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 18 },
  button: {
    alignItems: "center",
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  label: { fontSize: 15, fontWeight: "800" },
  error: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
});
