import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="page-width header-inner">
        <Link
          className="site-name"
          href="/"
          aria-label="Document & File Platform home"
        >
          Document &amp; File <span>Platform</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/tools">All tools</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </div>
    </header>
  );
}
