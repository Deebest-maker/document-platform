import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Document & File Platform — Preview",
    template: "%s | Document & File Platform",
  },
  description:
    "Merge PDFs on your device and explore the planned document toolkit.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <div className="preview-strip">
          <div className="page-width">
            <strong>Product preview</strong>
            <span>
              Merge PDF is available on your device. Other tools are planned.
            </span>
          </div>
        </div>
        <main
          id="main-content"
          tabIndex={-1}
          className="page-width main-content"
        >
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
