import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="page-width footer-inner">
        <div>
          <p className="footer-name">Document &amp; File Platform</p>
          <p className="small-copy">
            Merge PDF works on your device. Other tools are planned.
          </p>
        </div>
        <nav aria-label="Trust and legal">
          <Link href="/about">About</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
