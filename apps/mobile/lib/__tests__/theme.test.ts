import { themes } from "../theme";

describe("themes", () => {
  it("dark theme has the correct canvas color", () => {
    expect(themes.dark.colors.canvas).toBe("#0C0A14");
    expect(themes.dark.mode).toBe("dark");
  });

  it("light theme has a white canvas", () => {
    expect(themes.light.colors.canvas).toBe("#ffffff");
    expect(themes.light.mode).toBe("light");
  });

  it("both themes share the same accent brand color", () => {
    expect(themes.dark.colors.accent).toBe("#8000ff");
    expect(themes.light.colors.accent).toBe("#8000ff");
  });

  it("dark and light themes satisfy the same ThemeColors shape (same keys)", () => {
    const darkKeys = Object.keys(themes.dark.colors).sort();
    const lightKeys = Object.keys(themes.light.colors).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it("type scale has the expected font families from tokens", () => {
    expect(themes.dark.type.displayLarge.fontFamily).toBe("BrandDisplay-Medium");
    expect(themes.dark.type.paraLarge.fontFamily).toBe("BrandText-Book");
  });
});
