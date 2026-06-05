import type { AuthUser } from "@/lib/auth-client";

const DEMO_SESSION_KEY = "edumaster.demo_session";

// SECURITY: Demo admin account removed. A hardcoded admin credential in
// source code lets anyone impersonate an admin in the client-side UI
// (route guards, role checks). All admin server fns are protected by
// `requireSupabaseAuth` + `assertAdmin`, but the client-only admin
// experience must not be reachable without a real Supabase session.
// The student demo remains because it has no privileged capability.
export const DEMO_USERS: Record<string, AuthUser & { password: string }> = {
  "demo@student.com": {
    id: "demo-student-001",
    name: "Alex Morgan",
    email: "demo@student.com",
    role: "student",
    password: "Demo@1234",
  },
};

export function getDemoSession(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setDemoSession(user: AuthUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user));
}

export function clearDemoSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(DEMO_SESSION_KEY);
}

export function demoSignIn(email: string, password: string): AuthUser {
  const user = DEMO_USERS[email.trim().toLowerCase()];
  if (!user) throw new Error("No demo account found for this email.");
  if (user.password !== password) throw new Error("Incorrect password.");
  const { password: _pw, ...authUser } = user;
  setDemoSession(authUser);
  return authUser;
}
