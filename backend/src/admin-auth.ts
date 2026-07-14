import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const cookieName = "lunch_admin";
const sessionLifetimeSeconds = 8 * 60 * 60;
const failedAttemptWindowMs = 5 * 60 * 1_000;
const failedAttemptLimit = 5;

interface AdminAuthOptions {
  now?: () => number;
  password?: string;
}

interface FailureWindow {
  attempts: number;
  resetAt: number;
}

function hash(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function cookieValue(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === cookieName) return valueParts.join("=") || null;
  }
  return null;
}

export function createAdminAuth(options: AdminAuthOptions = {}) {
  const now = options.now ?? Date.now;
  const password = options.password;
  if (password && password.length < 16) {
    throw new Error("ADMIN_PASSWORD must contain at least 16 characters");
  }
  const expectedHash = password ? hash(password) : null;
  const sessions = new Map<string, number>();
  const failures = new Map<string, FailureWindow>();

  function removeExpiredSession(token: string): boolean {
    const expiresAt = sessions.get(token);
    if (!expiresAt || expiresAt <= now()) {
      sessions.delete(token);
      return false;
    }
    return true;
  }

  return {
    enabled: expectedHash !== null,
    authenticate(cookieHeader: string | undefined): boolean {
      const token = cookieValue(cookieHeader);
      return token ? removeExpiredSession(token) : false;
    },
    clearCookie(): string {
      return `${cookieName}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0`;
    },
    login(value: unknown, clientId: string):
      | { ok: true; token: string }
      | { ok: false; throttled: boolean } {
      if (!expectedHash || typeof value !== "string" || value.length > 1_024) {
        return { ok: false, throttled: false };
      }
      const currentTime = now();
      let failure = failures.get(clientId);
      if (failure && failure.resetAt <= currentTime) {
        failures.delete(clientId);
        failure = undefined;
      }
      if (failure && failure.attempts >= failedAttemptLimit) {
        return { ok: false, throttled: true };
      }
      if (!timingSafeEqual(hash(value), expectedHash)) {
        failures.set(clientId, {
          attempts: (failure?.attempts ?? 0) + 1,
          resetAt: failure?.resetAt ?? currentTime + failedAttemptWindowMs,
        });
        return { ok: false, throttled: false };
      }

      failures.delete(clientId);
      const token = randomBytes(32).toString("hex");
      sessions.set(token, currentTime + sessionLifetimeSeconds * 1_000);
      return { ok: true, token };
    },
    logout(cookieHeader: string | undefined): void {
      const token = cookieValue(cookieHeader);
      if (token) sessions.delete(token);
    },
    sessionCookie(token: string, secure: boolean): string {
      return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${sessionLifetimeSeconds}${secure ? "; Secure" : ""}`;
    },
  };
}
