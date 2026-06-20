import { setItemSouvenirImage } from "@/lib/api/items";
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
import { Image } from "expo-image";
import { Camera, ImagePlus } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

interface Props {
  itemId: string;
  souvenirImageUrl: string | null;
}

export function SouvenirPhotoButton({ itemId, souvenirImageUrl }: Props) {
  const { colors, radius, type } = useTheme();
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

      const updated = await setItemSouvenirImage(itemId, path);
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
        setError("Couldn't save the souvenir photo. Tap to retry.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surfaceGlass,
          borderColor: error ? colors.danger : colors.borderGlass,
          borderRadius: radius.lg,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View
          style={[
            styles.icon,
            {
              backgroundColor: colors.surfaceTint,
              borderColor: colors.borderGlass,
              borderRadius: radius.md,
            },
          ]}
        >
          <Camera size={18} color={colors.accentText} />
        </View>
        <View style={styles.copy}>
          <Text style={[type.headingSmall, { color: colors.textPrimary }]}>Souvenir photo</Text>
          <Text style={[type.label, styles.subcopy, { color: colors.textSecondary }]}>
            Add your own memory for a future shareable ticket.
          </Text>
        </View>
      </View>

      {souvenirImageUrl ? (
        <Image
          source={{ uri: souvenirImageUrl }}
          style={[styles.preview, { borderRadius: radius.md }]}
          contentFit="cover"
          transition={180}
        />
      ) : null}

      <Pressable
        onPress={onPress}
        disabled={busy || !session}
        accessibilityRole="button"
        accessibilityLabel={souvenirImageUrl ? "Change souvenir photo" : "Add souvenir photo"}
        style={[
          styles.button,
          {
            borderColor: colors.accent,
            borderRadius: radius.md,
            opacity: busy || !session ? 0.6 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <ImagePlus size={17} color={colors.accent} />
            <Text style={[type.cta, { color: colors.accent }]}>
              {souvenirImageUrl ? "Change souvenir photo" : "Add souvenir photo"}
            </Text>
          </>
        )}
      </Pressable>

      {error ? <Text style={[type.label, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    gap: 12,
    marginTop: 16,
    padding: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  icon: {
    width: 38,
    height: 38,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0 },
  subcopy: { marginTop: 3 },
  preview: {
    width: "100%",
    aspectRatio: 16 / 10,
  },
  button: {
    minHeight: 44,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
