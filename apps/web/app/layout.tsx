import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteHeader } from "../components/site-header";
import { SiteFooter } from "../components/site-footer";
import { getSiteConfig } from "../lib/site";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  SITE_NAME,
  siteRobots,
} from "../lib/seo";
import "./globals.css";

const site = getSiteConfig();

// No canonical here: a layout-level canonical would be inherited by every page.
export const metadata: Metadata = {
  metadataBase: site.origin ? new URL(site.origin) : undefined,
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: DEFAULT_DESCRIPTION,
  robots: siteRobots(site),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <SiteHeader />
        <aside className="preview-strip" aria-label="Product preview status">
          <div className="page-width">
            <strong>Product preview</strong>
            <span>
              Eleven tools are available on your device. Other tools are
              planned.
            </span>
          </div>
        </aside>
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
