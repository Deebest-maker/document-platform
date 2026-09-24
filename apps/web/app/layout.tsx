import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Document & File Platform",
  description: "Document & File Platform is under development.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <header className="site-header">
          <div className="page-width site-name">
            Document &amp; File Platform
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="page-width main-content"
        >
          {children}
        </main>
        <footer className="site-footer">
          <div className="page-width">Document &amp; File Platform</div>
        </footer>
      </body>
    </html>
  );
}
