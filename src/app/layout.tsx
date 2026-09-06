import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import ThemeProvider from "@/components/ThemeProvider";
import MotionProvider from "@/components/MotionProvider";
import Toaster from "@/components/Toaster";

const inter = localFont({
  src: "../../public/fonts/InterVariable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Pulse — Real-Time Messaging",
  description: "A production-oriented real-time messaging module.",
};

// Set the theme class before first paint to avoid a flash.
const noFlash = `(function(){try{var t=localStorage.getItem('rtm.theme');var d=t? t==='dark' : matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
      </head>
      <body>
        <ThemeProvider>
          <MotionProvider>{children}</MotionProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
