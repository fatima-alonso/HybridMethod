import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";

import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { WhatsAppFloatingButton } from "@/components/shared/WhatsAppFloatingButton";
import { FAQ } from "@/content/landing";
import { getWhatsAppNumber } from "@/lib/config";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "THE HYBRID METHOD · by Ferro Fits",
  description:
    "Entrenamiento personalizado de fuerza, running y rendimiento híbrido. Programas HM RUN, HM STRENGTH y HM COMPLETE.",
};

export const viewport: Viewport = {
  themeColor: "#111111",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const whatsappNumber = getWhatsAppNumber();
  return (
    <html
      lang="es"
      className={`${inter.variable} ${barlowCondensed.variable} h-full scroll-smooth`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 bg-volt px-4 py-2 font-semibold text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Saltar al contenido
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        {whatsappNumber ? (
          <WhatsAppFloatingButton number={whatsappNumber} message={FAQ.whatsappMessage} />
        ) : null}
      </body>
    </html>
  );
}
