import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Shell";

const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = { title: "Dennis", description: "Agent to agent to user" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={dmSans.className}>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
