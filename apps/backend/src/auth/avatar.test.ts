import { describe, expect, it } from "vitest";
import { resolveAvatarUrl, resolveDisplayName } from "./avatar";

const BASE_PAYLOAD = { sub: "abc-123" };

describe("resolveAvatarUrl", () => {
  it("prefers oauth avatar_url", () => {
    const url = resolveAvatarUrl({
      ...BASE_PAYLOAD,
      user_metadata: { avatar_url: "https://example.com/avatar.jpg" },
    });
    expect(url).toBe("https://example.com/avatar.jpg");
  });

  it("falls back to picture when avatar_url absent", () => {
    const url = resolveAvatarUrl({
      ...BASE_PAYLOAD,
      user_metadata: { picture: "https://example.com/pic.jpg" },
    });
    expect(url).toBe("https://example.com/pic.jpg");
  });

  it("generates a deterministic dicebear url when no oauth metadata", () => {
    const url = resolveAvatarUrl(BASE_PAYLOAD);
    expect(url).toContain("api.dicebear.com");
    expect(url).toContain(encodeURIComponent(BASE_PAYLOAD.sub));
    expect(resolveAvatarUrl(BASE_PAYLOAD)).toBe(url);
  });
});

describe("resolveDisplayName", () => {
  it("prefers full_name from user_metadata", () => {
    expect(resolveDisplayName({ ...BASE_PAYLOAD, user_metadata: { full_name: "Jane Doe" } })).toBe(
      "Jane Doe",
    );
  });

  it("falls back to name", () => {
    expect(resolveDisplayName({ ...BASE_PAYLOAD, user_metadata: { name: "Jane" } })).toBe("Jane");
  });

  it("falls back to email prefix", () => {
    expect(resolveDisplayName({ ...BASE_PAYLOAD, email: "jane@example.com" })).toBe("jane");
  });

  it("returns null when no metadata and no email", () => {
    expect(resolveDisplayName(BASE_PAYLOAD)).toBeNull();
  });
});
