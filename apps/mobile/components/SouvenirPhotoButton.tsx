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
import { LinearGradient } from "expo-linear-gradient";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";
import { Camera, Download, ImagePlus, Share2, TicketCheck } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import ViewShot, { type ViewShotRef } from "react-native-view-shot";

interface Props {
  itemId: string;
  title: string;
  categoryName: string | null;
  completedAt: string | null;
  souvenirImageUrl: string | null;
}

type TicketAction = "save" | "share";

function formatCompletionDate(completedAt: string | null): string {
  if (!completedAt) return "Completed";

  const date = new Date(completedAt);
  if (Number.isNaN(date.getTime())) return "Completed";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function SouvenirPhotoButton({
  itemId,
  title,
  categoryName,
  completedAt,
  souvenirImageUrl,
}: Props) {
  const { colors, radius, type } = useTheme();
  const { session } = useAuth();
  const upsert = useItemsStore((state) => state.upsert);
  const [busy, setBusy] = useState(false);
  const [ticketAction, setTicketAction] = useState<TicketAction | null>(null);
  const [ticketReady, setTicketReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticketRef = useRef<ViewShotRef>(null);

  async function choosePhoto() {
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
      setTicketReady(false);
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

  async function captureTicket(): Promise<string> {
    if (!ticketRef.current || !ticketReady) {
      throw new Error("ticket_not_ready");
    }

    return ticketRef.current.capture();
  }

  async function saveTicket() {
    if (ticketAction) return;
    setTicketAction("save");
    setError(null);

    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true, ["photo"]);
      if (!permission.granted) {
        setError("Photo access is needed to save your ticket.");
        return;
      }

      const uri = await captureTicket();
      await MediaLibrary.Asset.create(uri);
      Alert.alert("Ticket saved", "Your souvenir ticket is now in Photos.");
    } catch {
      setError("Couldn't save the ticket. Please try again.");
    } finally {
      setTicketAction(null);
    }
  }

  async function shareTicket() {
    if (ticketAction) return;
    setTicketAction("share");
    setError(null);

    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError("Sharing isn't available on this device.");
        return;
      }

      const uri = await captureTicket();
      await Sharing.shareAsync(uri, {
        dialogTitle: `Share ${title}`,
        mimeType: "image/png",
        UTI: "public.png",
      });
    } catch {
      setError("Couldn't share the ticket. Please try again.");
    } finally {
      setTicketAction(null);
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
      {souvenirImageUrl ? (
        <>
          <View style={styles.headerRow}>
            <View style={styles.copy}>
              <Text style={[type.headingSmall, { color: colors.textPrimary }]}>
                Your souvenir ticket
              </Text>
              <Text style={[type.label, styles.subcopy, { color: colors.textSecondary }]}>
                Save it or share the memory anywhere.
              </Text>
            </View>
            <TicketCheck size={22} color={colors.accentText} />
          </View>

          <ViewShot
            key={souvenirImageUrl}
            ref={ticketRef}
            options={{
              fileName: `lifelist-${itemId}`,
              format: "png",
              quality: 1,
              result: "tmpfile",
              width: 1080,
              height: 1350,
            }}
            style={[styles.ticket, { borderRadius: radius.lg }]}
          >
            <Image
              source={{ uri: souvenirImageUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onLoad={() => setTicketReady(true)}
              onError={() => setTicketReady(false)}
            />
            <LinearGradient
              colors={["rgba(8,5,15,0.08)", "rgba(8,5,15,0.18)", "rgba(8,5,15,0.92)"]}
              locations={[0, 0.48, 1]}
              pointerEvents="none"
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.ticketTop}>
              <View style={styles.ticketBrand}>
                <View style={styles.ticketBrandMark} />
                <Text style={styles.ticketBrandText}>LIFELIST</Text>
              </View>
              <Text style={styles.ticketNumber}>#{itemId.slice(0, 6).toUpperCase()}</Text>
            </View>
            <View style={styles.ticketCopy}>
              <View style={styles.completedBadge}>
                <TicketCheck size={13} color="#FFFFFF" />
                <Text style={styles.completedBadgeText}>COMPLETED</Text>
              </View>
              {categoryName ? (
                <Text style={styles.ticketCategory}>{categoryName.toUpperCase()}</Text>
              ) : null}
              <Text style={styles.ticketTitle}>{title}</Text>
              <View style={styles.ticketRule} />
              <Text style={styles.ticketDate}>{formatCompletionDate(completedAt)}</Text>
            </View>
          </ViewShot>

          <View style={styles.ticketActions}>
            <Pressable
              onPress={saveTicket}
              disabled={!ticketReady || ticketAction !== null}
              accessibilityRole="button"
              accessibilityLabel="Save souvenir ticket to photos"
              style={[
                styles.ticketButton,
                {
                  backgroundColor: colors.surfaceTint,
                  borderColor: colors.borderGlass,
                  borderRadius: radius.md,
                  opacity: !ticketReady || ticketAction !== null ? 0.55 : 1,
                },
              ]}
            >
              {ticketAction === "save" ? (
                <ActivityIndicator size="small" color={colors.accentText} />
              ) : (
                <Download size={17} color={colors.accentText} />
              )}
              <Text style={[type.cta, { color: colors.accentText }]}>Save</Text>
            </Pressable>
            <Pressable
              onPress={shareTicket}
              disabled={!ticketReady || ticketAction !== null}
              accessibilityRole="button"
              accessibilityLabel="Share souvenir ticket"
              style={[
                styles.ticketButton,
                {
                  backgroundColor: colors.accent,
                  borderColor: colors.accent,
                  borderRadius: radius.md,
                  opacity: !ticketReady || ticketAction !== null ? 0.55 : 1,
                },
              ]}
            >
              {ticketAction === "share" ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Share2 size={17} color="#FFFFFF" />
              )}
              <Text style={[type.cta, { color: "#FFFFFF" }]}>Share</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={choosePhoto}
            disabled={busy || !session}
            accessibilityRole="button"
            accessibilityLabel="Change souvenir photo"
            style={styles.changePhoto}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <ImagePlus size={15} color={colors.textSecondary} />
            )}
            <Text style={[type.label, { color: colors.textSecondary }]}>Change photo</Text>
          </Pressable>
        </>
      ) : (
        <>
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
              <Text style={[type.headingSmall, { color: colors.textPrimary }]}>
                Create a souvenir ticket
              </Text>
              <Text style={[type.label, styles.subcopy, { color: colors.textSecondary }]}>
                Add a photo from the moment. Lifelist will turn it into a shareable ticket.
              </Text>
            </View>
          </View>

          <Pressable
            onPress={choosePhoto}
            disabled={busy || !session}
            accessibilityRole="button"
            accessibilityLabel="Add souvenir photo"
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
                <Text style={[type.cta, { color: colors.accent }]}>Choose photo</Text>
              </>
            )}
          </Pressable>
        </>
      )}

      {error ? (
        <Text style={[type.label, styles.error, { color: colors.danger }]}>{error}</Text>
      ) : null}
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
  ticket: {
    width: "100%",
    aspectRatio: 4 / 5,
    overflow: "hidden",
    backgroundColor: "#1A1228",
  },
  ticketTop: {
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ticketBrand: { flexDirection: "row", alignItems: "center", gap: 8 },
  ticketBrandMark: {
    width: 11,
    height: 11,
    borderRadius: 3,
    backgroundColor: "#8000FF",
    transform: [{ rotate: "45deg" }],
  },
  ticketBrandText: {
    color: "#FFFFFF",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    letterSpacing: 2,
  },
  ticketNumber: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  ticketCopy: {
    marginTop: "auto",
    padding: 20,
  },
  completedBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#8000FF",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 12,
  },
  completedBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  ticketCategory: {
    color: "#FF66AF",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 5,
  },
  ticketTitle: {
    color: "#FFFFFF",
    fontSize: 27,
    lineHeight: 31,
    fontWeight: "900",
  },
  ticketRule: {
    width: 32,
    height: 2,
    backgroundColor: "#8000FF",
    marginTop: 14,
    marginBottom: 10,
  },
  ticketDate: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  ticketActions: {
    flexDirection: "row",
    gap: 10,
  },
  ticketButton: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  changePhoto: {
    minHeight: 34,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  error: { textAlign: "center" },
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
