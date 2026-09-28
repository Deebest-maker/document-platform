import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../../../app/globals.css";
import "./test-consumer.css";
export const metadata: Metadata = {
  title: "PDF foundation test consumer",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
