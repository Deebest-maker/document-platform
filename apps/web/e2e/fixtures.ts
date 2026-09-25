import { test as base, expect } from "@playwright/test";

// Only public application requests are observed; M1 never accepts document data.
export const test = base.extend<{ requestAudit: void }>({
  requestAudit: [
    async ({ page, baseURL }, use) => {
      const unexpected: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (
          url.origin !== new URL(baseURL!).origin ||
          !["GET", "HEAD"].includes(request.method()) ||
          /\/(api|uploads?|jobs|health)\//.test(url.pathname)
        ) {
          unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
        }
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await use();
      expect(
        unexpected,
        "No third-party, upload, processor or mutation requests",
      ).toEqual([]);
      expect(errors, "No browser runtime errors").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";
