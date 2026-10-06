import { AuthGate } from "@/components/auth-gate";

// No server-side work here: every app screen is a static page (instant tab switches from the CDN);
// the session is checked in the browser by AuthGate.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate>{children}</AuthGate>;
}
