import { test as base, expect } from "@playwright/test";

// Observe the entire context, including dedicated workers. Keep diagnostics coarse.
export const test = base.extend<{ requestAudit: void }>({
  requestAudit: [
    async ({ page, context, baseURL }, use) => {
      let unexpected = 0;
      let errors = 0;
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (
          url.origin !== new URL(baseURL!).origin ||
          !["GET", "HEAD"].includes(request.method()) ||
          /\/(api|uploads?|jobs|health)\//.test(url.pathname)
        ) {
          unexpected++;
        }
      });
      page.on("pageerror", () => errors++);
      page.on("websocket", () => unexpected++);
      await use();
      expect(
        unexpected,
        "No third-party, upload, processor or mutation requests",
      ).toBe(0);
      expect(errors, "No browser runtime errors").toBe(0);
    },
    { auto: true },
  ],
});
export { expect } from "@playwright/test";
