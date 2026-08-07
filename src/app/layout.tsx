import type { Metadata } from "next";
import { Lato, Merriweather, Roboto_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/shell/Sidebar";
import CommandPalette from "@/components/shell/CommandPalette";
import ThemeProvider from "@/components/shell/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const lato = Lato({
  subsets: ["latin"],
  weight: ["400", "700", "900"],
  variable: "--font-lato",
});
const merriweather = Merriweather({
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  variable: "--font-merriweather",
});
const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-roboto-mono",
});

export const metadata: Metadata = {
  title: "Servo — AI service desk",
  description:
    "Open-source service desk where tickets are resolved by humans and AI agents, with approvals, QA and KPIs built in.",
};

// The whole app is a live database UI; never prerender.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(lato.variable, merriweather.variable, robotoMono.variable)}
    >
      <body className="bg-background font-sans text-foreground antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
          <CommandPalette />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
