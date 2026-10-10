// Small per-device conveniences (never business data). Wrapped in try/catch
// because storage can be unavailable (private mode, blocked site data).

const PREFIX = "denaru:";

export function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, value);
  } catch {
    // ignore
  }
}

export function clearLocalAppState() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // ignore
  }
}
