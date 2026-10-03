import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Spends",
  description: "Log daily spends in seconds and stay inside your budget.",
  applicationName: "Spends",
  appleWebApp: { capable: true, title: "Spends", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/192", apple: "/icons/180" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef3fb" },
    { media: "(prefers-color-scheme: dark)", color: "#080d1c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <SwRegister />
      </body>
    </html>
  );
}
