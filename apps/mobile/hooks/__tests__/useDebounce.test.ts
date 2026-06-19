import { act, renderHook } from "@testing-library/react-native";
import { useDebounce } from "../useDebounce";

jest.useFakeTimers();

test("returns initial value immediately", () => {
  const { result } = renderHook(() => useDebounce("hello", 500));
  expect(result.current).toBe("hello");
});

test("does not update before delay has elapsed", () => {
  const { result, rerender } = renderHook((v: string) => useDebounce(v, 500), {
    initialProps: "a",
  });
  rerender("ab");
  rerender("abc");
  act(() => {
    jest.advanceTimersByTime(499);
  });
  expect(result.current).toBe("a");
});

test("updates to latest value after delay", () => {
  const { result, rerender } = renderHook((v: string) => useDebounce(v, 500), {
    initialProps: "a",
  });
  rerender("ab");
  rerender("abc");
  act(() => {
    jest.advanceTimersByTime(500);
  });
  expect(result.current).toBe("abc");
});

test("resets timer on each change", () => {
  const { result, rerender } = renderHook((v: string) => useDebounce(v, 500), {
    initialProps: "a",
  });
  act(() => {
    jest.advanceTimersByTime(300);
  });
  rerender("ab");
  act(() => {
    jest.advanceTimersByTime(300);
  });
  expect(result.current).toBe("a");
  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(result.current).toBe("ab");
});
