const mockGetSession = jest.fn();
const mockSignOut = jest.fn();

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        apiBaseUrl: "https://api.example.test/api/",
      },
    },
  },
}));

jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      signOut: mockSignOut,
    },
  },
}));

const { apiFetch, ApiError, NetworkError } =
  jest.requireActual<typeof import("./client")>("./client");

describe("apiFetch", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSignOut.mockReset();
    global.fetch = jest.fn();
  });

  it("resolves paths against the configured API base and injects the latest JWT", async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: { access_token: "fresh-token" } },
    });
    jest.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));

    await apiFetch("/items");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/items",
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const headers = jest.mocked(global.fetch).mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer fresh-token");
  });

  it("signs out locally only for explicit invalid-token 401s", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "bad-token" } },
    });
    jest
      .mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "token_invalid" }), { status: 401 }),
      );

    await expect(apiFetch("/items")).rejects.toMatchObject({
      status: 401,
      authInvalid: true,
    });

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("preserves the local session for ambiguous 401 responses", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "maybe-good-token" } },
    });
    jest
      .mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "temporarily_unavailable" }), { status: 401 }),
      );

    await expect(apiFetch("/items")).rejects.toBeInstanceOf(ApiError);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("does not retry non-idempotent requests after a network failure", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    jest.mocked(global.fetch).mockRejectedValueOnce(new Error("offline"));

    await expect(apiFetch("/items/create", { method: "POST" })).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
