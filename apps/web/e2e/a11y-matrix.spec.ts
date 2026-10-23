import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// M7E (ADR-036): the accessibility matrix. Every page, and every state of every
// tool, is looked at the way four kinds of visitor meet it:
//
//   1. an automated rule check (WCAG 2.0 A/AA, 2.1 A/AA, 2.2 AA, best practice,
//      and the rule for a visible label being part of the accessible name);
//   2. a person using only a keyboard: Tab through the whole page, every control
//      is reached, focus is never lost, never trapped, never hidden behind
//      something, always drawn with enough contrast, and every control is at
//      least 24 by 24 CSS px (WCAG 2.5.8);
//   3. a person using a screen reader: every control has a name in the
//      browser's own accessibility tree, and a state change is announced and
//      leaves focus somewhere sensible;
//   4. a person who enlarges text or needs a narrow screen: nothing runs off the
//      side at 320 px, at 200% text, or with the WCAG text-spacing settings,
//      nothing is cut off, and anything that scrolls inside the page can be
//      scrolled with a keyboard.
//
// Findings are collected per state and reported together, so a run lists every
// problem instead of stopping at the first.

test.describe.configure({ timeout: 300_000 });

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../tests/fixtures/pdf/${name}`, import.meta.url),
  );
const read = (name: string) => readFileSync(fixture(name));
const PDF = "application/pdf";
const FOUR_PAGES = read("preview-features.pdf");

const WCAG = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

// ── 1. Automated rules ──────────────────────────────────────────────────

async function rules(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG)
    // WCAG 2.5.3, Label in Name: axe keeps it behind a flag.
    .options({ rules: { "label-content-name-mismatch": { enabled: true } } })
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes
      .slice(0, 4)
      .map(
        (node) =>
          `rule ${violation.id} (${violation.impact}): ${node.target.join(" ")}`,
      ),
  );
}

// ── 2. Keyboard ─────────────────────────────────────────────────────────

interface Stop {
  key: string;
  body?: boolean;
  /** This very element was focused earlier in the walk. */
  again: boolean;
  /** It is the element that already had focus before this press. */
  same: boolean;
  hidden: boolean;
  outline: string;
  shadow: boolean;
  ringContrast: number | null;
  covered: string | null;
}

/** Describes the focused element: where it is, how its focus is drawn. */
const describeFocus = (): Stop => {
  const el = document.activeElement as HTMLElement | null;
  const empty = {
    again: false,
    same: false,
    key: "",
    hidden: false,
    outline: "",
    shadow: false,
    ringContrast: null,
    covered: null,
  };
  if (!el || el === document.body || el === document.documentElement)
    return { ...empty, body: true };

  const nameOf = (node: Element): string => {
    const id = node.id ? `#${node.id}` : "";
    const cls =
      typeof node.className === "string" && node.className
        ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
        : "";
    const label =
      node.getAttribute("aria-label") ??
      (node as HTMLInputElement).labels?.[0]?.textContent ??
      node.textContent ??
      "";
    const text = label.trim().replace(/\s+/g, " ").slice(0, 28);
    return `${node.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
  };

  const channels = (colour: string): number[] | null => {
    const match = colour.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1]
      .split(/[,/ ]+/)
      .filter(Boolean)
      .map(Number);
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  };
  const luminance = ([r, g, b]: number[]) => {
    const lin = (value: number) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };

  // What is behind the focus ring: the nearest opaque background above it.
  let behind = [255, 255, 255];
  for (let node: Element | null = el.parentElement; node;) {
    const colour = channels(getComputedStyle(node).backgroundColor);
    if (colour && colour[3] === 1) {
      behind = colour.slice(0, 3);
      break;
    }
    node = node.parentElement;
  }

  const style = getComputedStyle(el);
  const hasOutline =
    style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
  let ringContrast: number | null = null;
  if (hasOutline) {
    const ring = channels(style.outlineColor);
    if (ring) {
      const a = luminance(ring) + 0.05;
      const b = luminance(behind) + 0.05;
      ringContrast = Math.max(a, b) / Math.min(a, b);
    }
  }

  const walk = ((
    window as unknown as { __walk?: { seen: WeakSet<Element>; last?: Element } }
  ).__walk ??= {
    seen: new WeakSet(),
  });
  const again = walk.seen.has(el);
  const same = walk.last === el;
  walk.seen.add(el);
  walk.last = el;

  // Look at the middle of the part of the element that is on screen: a tall
  // element can be larger than the window, and its middle is not on screen.
  const box = el.getBoundingClientRect();
  const left = Math.max(box.left, 0);
  const right = Math.min(box.right, innerWidth);
  const above = Math.max(box.top, 0);
  const below = Math.min(box.bottom, innerHeight);
  let covered: string | null = null;
  if (right > left && below > above) {
    const top = document.elementFromPoint(
      (left + right) / 2,
      (above + below) / 2,
    );
    covered =
      top && !(el.contains(top) || top.contains(el)) ? nameOf(top) : null;
  }

  return {
    again,
    same,
    key: nameOf(el),
    hidden: box.width <= 2 || box.height <= 2,
    outline: hasOutline ? `${style.outlineWidth} ${style.outlineStyle}` : "",
    shadow: style.boxShadow !== "none",
    ringContrast,
    covered,
  };
};

/** The controls a person can operate that the walk never landed on. */
const unreached = () => {
  const walk = (window as unknown as { __walk?: { seen: WeakSet<Element> } })
    .__walk;
  const selector =
    "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable='true']";
  const radios = new Set<string>();
  const missed: string[] = [];
  let total = 0;
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>(selector),
  )) {
    if (el.matches(":disabled") || el.tabIndex < 0) continue;
    if (el instanceof HTMLInputElement && el.type === "hidden") continue;
    if (el.closest("[inert], [hidden], [aria-hidden='true']")) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    // Only one radio in a group is a Tab stop; the rest take the arrow keys.
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      if (radios.has(el.name)) continue;
      radios.add(el.name);
      total++;
      const group = Array.from(
        document.querySelectorAll(`input[type="radio"][name="${el.name}"]`),
      );
      if (!group.some((radio) => walk?.seen.has(radio)))
        missed.push(`radio group ${el.name}`);
      continue;
    }
    total++;
    if (walk?.seen.has(el)) continue;
    const label = (
      el.getAttribute("aria-label") ??
      (el as HTMLInputElement).labels?.[0]?.textContent ??
      el.textContent ??
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 28);
    missed.push(
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${label ? ` "${label}"` : ""}`,
    );
  }
  return { total, missed };
};

async function keyboard(page: Page): Promise<string[]> {
  const found: string[] = [];
  // Start from the top of the document, the way a fresh visit does.
  await page.evaluate(() => {
    (window as unknown as { __walk?: unknown }).__walk = undefined;
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
    document.getSelection()?.collapse(document.body, 0);
  });
  // Focus may start part-way down the page (after the tool moved it), so go to
  // the end of the order, then round again from the top until it repeats.
  let steps = 0;
  let ends = 0;
  const limit = 400;
  while (steps++ < limit) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(describeFocus);
    if (stop.body) {
      // focus left the page: the end of the order
      if (++ends === 2) break;
      continue;
    }
    if (stop.same) {
      // Some browsers have nowhere to send focus after the last control, so it
      // stays there. That is the end of the order, not a trap, if nothing
      // after it could take focus.
      const last = await page.evaluate(() => {
        const stops = Array.from(
          document.querySelectorAll<HTMLElement>(
            "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable='true']",
          ),
        ).filter(
          (el) =>
            !el.matches(":disabled") &&
            el.tabIndex >= 0 &&
            el.getClientRects().length > 0 &&
            getComputedStyle(el).visibility !== "hidden" &&
            !el.closest("[inert], [hidden]"),
        );
        return stops[stops.length - 1] === document.activeElement;
      });
      if (!last) {
        found.push(`keyboard: focus is stuck on ${stop.key}`);
        break;
      }
      if (++ends === 2) break;
      // Start again from the top, as a visitor pressing Tab from the address
      // bar would.
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
        document.getSelection()?.collapse(document.body, 0);
      });
      continue;
    }
    if (stop.again) break; // came round to the start again
    if (stop.covered)
      found.push(`focus obscured: ${stop.key} is covered by ${stop.covered}`);
    if (!stop.outline && !stop.shadow)
      found.push(`no focus indicator: ${stop.key}`);
    else if (stop.ringContrast !== null && stop.ringContrast < 3)
      found.push(
        `focus ring contrast ${stop.ringContrast.toFixed(2)}:1 is under 3:1: ${stop.key}`,
      );
    if (stop.hidden && !stop.outline)
      found.push(`focus on an element that cannot be seen: ${stop.key}`);
  }
  // Everything a person can operate has to be reachable without a pointer.
  const { missed } = await page.evaluate(unreached);
  for (const name of missed.slice(0, 6))
    found.push(`not reachable with Tab: ${name}`);
  return found;
}

// ── 3. Screen reader ────────────────────────────────────────────────────

const UNNAMED =
  /^\s*- (button|link|checkbox|radio|textbox|combobox|searchbox|slider|spinbutton|switch|tab|menuitem|option)((?: \[[^\]]*\])*):?\s*$/;

async function names(page: Page): Promise<string[]> {
  const tree = await page.locator("body").ariaSnapshot();
  const found = tree
    .split("\n")
    .filter((line) => UNNAMED.test(line))
    .map((line) => `no accessible name in the browser's tree: ${line.trim()}`);
  // Pictures drawn in a canvas say nothing unless they are named or hidden.
  const pictures = await page.evaluate(() =>
    Array.from(document.querySelectorAll("canvas"))
      .filter(
        (canvas) =>
          canvas.getAttribute("aria-hidden") !== "true" &&
          !canvas.closest("[aria-hidden='true']") &&
          !canvas.getAttribute("aria-label") &&
          !canvas.closest("[aria-label], [aria-labelledby]"),
      )
      .map((canvas) => canvas.className || "canvas"),
  );
  for (const picture of pictures)
    found.push(`a canvas is neither named nor hidden: ${picture}`);
  return found;
}

/** Focus must be somewhere in the page after a state change, not on <body>. */
async function focusKept(page: Page): Promise<string[]> {
  const where = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement)
      return "body";
    return el.tagName.toLowerCase();
  });
  return where === "body" ? ["focus was lost to the page body"] : [];
}

/**
 * A change of state has to reach a screen reader: either focus is moved to the
 * new state's heading (which is read out), or a live region carries the news.
 */
async function announced(page: Page): Promise<string[]> {
  const spoken = await page.evaluate(() => {
    const active = document.activeElement;
    if (
      active?.matches("[data-state-heading]") ||
      active?.closest("[role='alert']")
    )
      return true;
    // A field that is invalid and described by its message, with focus on it,
    // is read out as the label, "invalid" and the message.
    if (active?.matches("[aria-invalid='true']")) {
      const ids = (active.getAttribute("aria-describedby") ?? "").split(/\s+/);
      if (ids.some((id) => document.getElementById(id)?.textContent?.trim()))
        return true;
    }
    return Array.from(
      document.querySelectorAll(
        "[role='status'], [role='alert'], [aria-live='polite'], [aria-live='assertive']",
      ),
    ).some((region) => (region.textContent ?? "").trim());
  });
  return spoken
    ? []
    : ["nothing was announced and focus was not moved to the new state"];
}

/** An invalid field points to the message that explains it (WCAG 3.3.1). */
async function fieldErrors(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[aria-invalid='true']")).flatMap(
      (field) => {
        const ids = (field.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter(Boolean);
        const explained = ids.some((id) =>
          document.getElementById(id)?.textContent?.trim(),
        );
        return explained
          ? []
          : [
              `an invalid field has no error message attached: ${field.id || field.getAttribute("aria-label") || field.tagName}`,
            ];
      },
    ),
  );
}

/** WCAG 1.4.11: the edge of a text field is told apart from what is behind it. */
async function fieldEdges(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const channels = (colour: string) => {
      const m = colour.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1]
        .split(/[,/ ]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const lin = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: number[], b: number[]) => {
      const x = lum(a) + 0.05;
      const y = lum(b) + 0.05;
      return Math.max(x, y) / Math.min(x, y);
    };
    const out: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(
        "input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select, textarea",
      ),
    )) {
      const style = getComputedStyle(el);
      if (style.display === "none" || el.getBoundingClientRect().width < 4)
        continue;
      const edge = channels(style.borderTopColor);
      const own = channels(style.backgroundColor);
      let behind = [255, 255, 255];
      for (let n: Element | null = el.parentElement; n; n = n.parentElement) {
        const c = channels(getComputedStyle(n).backgroundColor);
        if (c && c[3] === 1) {
          behind = c.slice(0, 3);
          break;
        }
      }
      const drawn = parseFloat(style.borderTopWidth) > 0 && edge && edge[3] > 0;
      const best = Math.max(
        drawn ? ratio(edge.slice(0, 3), behind) : 0,
        own && own[3] === 1 ? ratio(own.slice(0, 3), behind) : 0,
      );
      if (best < 3)
        out.push(
          `the edge of a field has contrast ${best.toFixed(2)}:1 against what is behind it: ${el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase()}`,
        );
    }
    return out;
  });
}

// ── 4. Reflow, text size and spacing ────────────────────────────────────

const overflow = () => {
  const wide = document.documentElement.scrollWidth > innerWidth + 1;
  const offenders: string[] = [];
  if (wide) {
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.right <= innerWidth + 1) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" || style.visibility === "hidden") continue;
      // Name it well enough to find from a CI annotation: its tag and class,
      // the nearest classed ancestor, and the start of its text.
      const named = (node: Element) =>
        `${node.tagName.toLowerCase()}${typeof node.className === "string" && node.className ? `.${node.className.trim().split(/\s+/)[0]}` : ""}`;
      let owner: Element | null = el.parentElement;
      while (owner && !(typeof owner.className === "string" && owner.className))
        owner = owner.parentElement;
      const words = (el.textContent ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 24);
      offenders.push(
        `${named(el)}${owner ? ` in ${named(owner)}` : ""}${words ? ` "${words}"` : ""} (${Math.round(box.left)}–${Math.round(box.right)})`,
      );
      if (offenders.length === 4) break;
    }
  }
  return { wide, offenders };
};

const clipped = () => {
  const out: string[] = [];
  for (const el of Array.from(
    document.body.querySelectorAll<HTMLElement>("*"),
  )) {
    const style = getComputedStyle(el);
    if (!/(hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`))
      continue;
    if (
      el.classList.contains("visually-hidden") ||
      el.classList.contains("sr-only") ||
      !el.textContent?.trim()
    )
      continue;
    if (el.clientWidth === 0 || el.clientHeight === 0) continue;
    if (
      el.scrollHeight > el.clientHeight + 2 ||
      el.scrollWidth > el.clientWidth + 2
    )
      out.push(
        `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ""}`,
      );
    if (out.length === 4) break;
  }
  return out;
};

/**
 * Whatever scrolls inside the page can be scrolled with a keyboard: it is
 * focusable itself or holds something focusable (WCAG 2.1.1). Enlarged text is
 * what makes a table or a list start to scroll, so this runs in every setting.
 */
const scrollers = () => {
  const out: string[] = [];
  for (const el of Array.from(
    document.body.querySelectorAll<HTMLElement>("*"),
  )) {
    const style = getComputedStyle(el);
    const across =
      /(auto|scroll)/.test(style.overflowX) &&
      el.scrollWidth > el.clientWidth + 1;
    const down =
      /(auto|scroll)/.test(style.overflowY) &&
      el.scrollHeight > el.clientHeight + 1;
    if (!across && !down) continue;
    const reachable =
      el.tabIndex >= 0 ||
      el.querySelector(
        "a[href], button:not(:disabled), input:not(:disabled), select, textarea, summary, [tabindex]:not([tabindex='-1'])",
      );
    if (!reachable)
      out.push(
        `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : ""}`,
      );
    if (out.length === 4) break;
  }
  return out;
};

/**
 * Something to press or type into is at least 24 by 24 CSS pixels (WCAG 2.2
 * 2.5.8, level AA). A control's label counts with it when pressing the label
 * works the control; a link inside a sentence is exempt, as the criterion says.
 */
const targets = () => {
  const MIN = 24;
  const out: string[] = [];
  const hiddenClass = (el: Element) =>
    el.classList.contains("visually-hidden") ||
    el.classList.contains("sr-only");
  for (const el of Array.from(
    document.body.querySelectorAll<HTMLElement>(
      "button, input:not([type='hidden']), select, textarea, summary, [role='button'], a[href]",
    ),
  )) {
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || el.closest("[hidden], [inert]"))
      continue;
    if (el.matches("a[href]") && style.display === "inline") continue;
    if (el.matches(":disabled")) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    let width = box.width;
    let height = box.height;
    for (const label of Array.from((el as HTMLInputElement).labels ?? [])) {
      const labelBox = label.getBoundingClientRect();
      width = Math.max(width, labelBox.width);
      height = Math.max(height, labelBox.height);
    }
    if (hiddenClass(el) && el.matches("input")) continue;
    const name = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || el.id || "").trim().slice(0, 30)}"`;
    if (width + 0.5 < MIN || height + 0.5 < MIN)
      out.push(
        `target too small (WCAG 2.5.8): ${name} is ${Math.round(width)}×${Math.round(height)}`,
      );
    // A one-line field is one line tall. (A flex basis meant as a width once
    // made a text field 320 px tall on phones.)
    if (
      el.matches(
        "input:not([type='checkbox']):not([type='radio']):not([type='file']):not([type='range'])",
      ) &&
      box.height > 120
    )
      out.push(
        `a one-line field is ${Math.round(box.height)} px tall: ${name}`,
      );
    if (out.length === 4) break;
  }
  return out;
};

const WIDE_FONT = `* { font-family: "DejaVu Sans", Verdana, sans-serif !important; }`;

const SPACING = `
  * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
  p { margin-bottom: 2em !important; }
`;

async function reflow(page: Page): Promise<string[]> {
  const found: string[] = [];
  const original = page.viewportSize();
  const check = async (label: string) => {
    const report = await page.evaluate(overflow);
    if (report.wide)
      found.push(
        `reflow (${label}): the page scrolls sideways; wide: ${report.offenders.join(", ")}`,
      );
    const cut = await page.evaluate(clipped);
    if (cut.length) found.push(`text cut off (${label}): ${cut.join(", ")}`);
    const stuck = await page.evaluate(scrollers);
    if (stuck.length)
      found.push(
        `scrolls but a keyboard cannot reach it (${label}): ${stuck.join(", ")}`,
      );
  };

  // Letters are wider in some fonts than others, and a visitor's default font
  // is not ours to choose, so the page is measured in a wide one: what fits in
  // it fits in the narrower fonts too. (Where DejaVu Sans is not installed the
  // browser falls back, and the check is only as strict as that font.)
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [sheet];
  }, WIDE_FONT);
  await page.setViewportSize({ width: 320, height: 800 });
  await check("320 px");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await check("320 px, text 200%");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await page.evaluate((css) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, SPACING);
  await check("320 px, text spacing");
  if (original) await page.setViewportSize(original);
  await check("text spacing");
  await page.evaluate(() => {
    document.adoptedStyleSheets = [];
  });
  return found;
}

// ── The scenes ──────────────────────────────────────────────────────────

interface Scene {
  name: string;
  /** Gets the page into this state; runs after the route has loaded. */
  enter?: (page: Page) => Promise<void>;
  /** The state was reached by a person's action, so focus must have been kept. */
  moved?: boolean;
  /** The state tells the person something new, so it must be announced. */
  announces?: boolean;
}

async function audit(page: Page, scene: Scene): Promise<string[]> {
  const found: string[] = [];
  if (scene.moved) found.push(...(await focusKept(page)));
  if (scene.announces) found.push(...(await announced(page)));
  found.push(...(await rules(page)));
  found.push(...(await names(page)));
  found.push(...(await fieldErrors(page)));
  found.push(...(await fieldEdges(page)));
  found.push(...(await page.evaluate(targets)));
  found.push(...(await keyboard(page)));
  found.push(...(await reflow(page)));
  return found;
}

async function run(page: Page, route: string, scenes: Scene[]) {
  for (const scene of scenes) {
    await test.step(`${route} — ${scene.name}`, async () => {
      await page.goto(route);
      // A state that cannot be reached is a failure of its own, and the scenes
      // after it still run, so one broken state does not hide the rest.
      try {
        await scene.enter?.(page);
      } catch (error) {
        const reason = String((error as Error).message).split("\n")[0];
        expect
          .soft(
            [`this state could not be reached: ${reason}`],
            `${route} — ${scene.name}`,
          )
          .toEqual([]);
        return;
      }
      const found = await audit(page, scene);
      expect.soft(found, `${route} — ${scene.name}`).toEqual([]);
    });
  }
}

const picker = (page: Page) => page.locator('input[type="file"]').first();
const choose = (page: Page, name: string, buffer: Buffer) =>
  picker(page).setInputFiles({ name, mimeType: PDF, buffer });
const heading = (page: Page, name: string | RegExp) =>
  expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 45_000 });
const alert = (page: Page) =>
  expect(page.getByRole("main").getByRole("alert").first()).toBeVisible({
    timeout: 30_000,
  });

const CORRUPT = read("corrupt.pdf");

// ── Page tools ──────────────────────────────────────────────────────────

const loaded = async (page: Page) => {
  await choose(page, "four.pdf", FOUR_PAGES);
  await expect(page.locator("li[data-page-id]")).toHaveCount(4, {
    timeout: 45_000,
  });
};
const rejected = async (page: Page) => {
  await choose(page, "damaged.pdf", CORRUPT);
  await alert(page);
};

function pageTool(
  route: string,
  extra: (Scene | undefined)[],
): [string, Scene[]] {
  return [
    route,
    [
      { name: "ready for a file" },
      { name: "a PDF loaded", enter: loaded, moved: true },
      ...(extra.filter(Boolean) as Scene[]),
      {
        name: "a file that cannot be opened",
        enter: rejected,
        moved: true,
        announces: true,
      },
    ],
  ];
}

const TOOL_SCENES: [string, Scene[]][] = [
  pageTool("/extract-pdf-pages", [
    {
      name: "two pages chosen",
      enter: async (page) => {
        await loaded(page);
        await page.getByLabel("Select source page 2 for extraction").check();
        await page.getByLabel("Select source page 4 for extraction").check();
      },
    },
    {
      name: "result",
      enter: async (page) => {
        await loaded(page);
        await page.getByLabel("Select source page 2 for extraction").check();
        await page
          .getByRole("button", { name: "Export selected pages" })
          .click();
        await expect(
          page.getByRole("link", { name: "Download extracted pages" }),
        ).toBeVisible({ timeout: 45_000 });
      },
      moved: true,
      announces: true,
    },
  ]),
  pageTool("/delete-pdf-pages", [
    {
      name: "a page chosen",
      enter: async (page) => {
        await loaded(page);
        await page.getByRole("checkbox").first().check();
      },
    },
    {
      name: "result",
      enter: async (page) => {
        await loaded(page);
        await page.getByRole("checkbox").first().check();
        await page
          .getByRole("button", { name: "Export remaining pages" })
          .click();
        await expect(
          page.getByRole("link", { name: "Download remaining pages" }),
        ).toBeVisible({ timeout: 45_000 });
      },
      moved: true,
      announces: true,
    },
  ]),
  pageTool("/rotate-pdf", [
    {
      name: "rotated",
      enter: async (page) => {
        await loaded(page);
        await page.getByRole("button", { name: "Rotate all right" }).click();
      },
    },
    {
      name: "result",
      enter: async (page) => {
        await loaded(page);
        await page.getByRole("button", { name: "Rotate all right" }).click();
        await page.getByRole("button", { name: "Export rotated PDF" }).click();
        await expect(
          page.getByRole("link", { name: "Download rotated PDF" }),
        ).toBeVisible({ timeout: 45_000 });
      },
      moved: true,
      announces: true,
    },
  ]),
  pageTool("/organize-pdf", [
    {
      name: "pages moved",
      enter: async (page) => {
        await loaded(page);
        await page
          .getByRole("button", { name: "Move later, page 1", exact: true })
          .click();
      },
    },
    {
      name: "result",
      enter: async (page) => {
        await loaded(page);
        await page
          .getByRole("button", { name: "Move later, page 1", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Export organized PDF" })
          .click();
        await expect(
          page.getByRole("link", { name: "Download organized PDF" }),
        ).toBeVisible({ timeout: 45_000 });
      },
      moved: true,
      announces: true,
    },
  ]),
  pageTool("/split-pdf", [
    {
      name: "a range that does not fit the document",
      enter: async (page) => {
        await loaded(page);
        await page.getByLabel("Output 1 page ranges").fill("9-99");
        await page
          .getByRole("button", { name: "Generate split files" })
          .click();
        await expect(page.locator("[aria-invalid='true']")).toHaveCount(1);
      },
      announces: true,
    },
    {
      name: "result",
      enter: async (page) => {
        await loaded(page);
        await page.getByLabel("Output 1 page ranges").fill("1-2");
        await page
          .getByRole("button", { name: "Generate split files" })
          .click();
        await heading(page, "Your split PDF is ready");
      },
      moved: true,
      announces: true,
    },
  ]),
  pageTool("/pdf-to-jpg", [
    {
      name: "pages chosen",
      enter: async (page) => {
        await loaded(page);
        await page.getByLabel("Selected pages").check();
        await page.getByLabel("Select source page 2 for JPG export").check();
      },
    },
    {
      name: "result",
      enter: async (page) => {
        await loaded(page);
        await page.getByRole("button", { name: "Create JPG images" }).click();
        await heading(page, "Your JPG ZIP is ready");
      },
      moved: true,
      announces: true,
    },
  ]),
  [
    "/merge-pdf",
    [
      { name: "ready for files" },
      {
        name: "two files listed",
        enter: async (page) => {
          await picker(page).setInputFiles([
            { name: "a.pdf", mimeType: PDF, buffer: read("a.pdf") },
            { name: "b.pdf", mimeType: PDF, buffer: read("b.pdf") },
          ]);
          await expect(page.locator(".selected-file")).toHaveCount(2);
        },
      },
      {
        name: "a file that cannot be merged",
        enter: async (page) => {
          await picker(page).setInputFiles([
            { name: "a.pdf", mimeType: PDF, buffer: read("a.pdf") },
            { name: "damaged.pdf", mimeType: PDF, buffer: CORRUPT },
          ]);
          await page
            .getByRole("button", { name: "Merge PDFs", exact: true })
            .click();
          await heading(page, "Check your selection");
        },
        moved: true,
        announces: true,
      },
      {
        name: "result",
        enter: async (page) => {
          await picker(page).setInputFiles([
            { name: "a.pdf", mimeType: PDF, buffer: read("a.pdf") },
            { name: "b.pdf", mimeType: PDF, buffer: read("b.pdf") },
          ]);
          await page
            .getByRole("button", { name: "Merge PDFs", exact: true })
            .click();
          await heading(page, "Your merged PDF is ready");
        },
        moved: true,
        announces: true,
      },
    ],
  ],
  [
    "/compress-pdf",
    [
      { name: "ready for a file" },
      {
        name: "strength to choose",
        enter: async (page) => {
          await choose(page, "a.pdf", read("a.pdf"));
          await heading(page, "Choose how much to compress");
        },
        moved: true,
      },
      {
        name: "result",
        enter: async (page) => {
          await choose(page, "a.pdf", read("a.pdf"));
          await heading(page, "Choose how much to compress");
          await page
            .getByRole("button", { name: "Compress PDF", exact: true })
            .click();
          await heading(
            page,
            /Compressed PDF ready|This PDF could not be made smaller/,
          );
        },
        moved: true,
        announces: true,
      },
      {
        name: "a file that cannot be opened",
        enter: async (page) => {
          await choose(page, "damaged.pdf", CORRUPT);
          await page
            .getByRole("button", { name: "Compress PDF", exact: true })
            .click({ timeout: 5_000 })
            .catch(() => undefined);
          await alert(page);
        },
        moved: true,
        announces: true,
      },
    ],
  ],
  [
    "/pdf-to-text",
    [
      { name: "ready for a file" },
      {
        name: "result",
        enter: async (page) => {
          await choose(page, "text.pdf", read("text-partial.pdf"));
          await heading(page, /Extracted text ready|No text layer was found/);
        },
        moved: true,
        announces: true,
      },
      {
        name: "a file that cannot be opened",
        enter: async (page) => {
          await choose(page, "damaged.pdf", CORRUPT);
          await alert(page);
        },
        moved: true,
        announces: true,
      },
    ],
  ],
  [
    "/remove-pdf-metadata",
    [
      { name: "ready for a file" },
      {
        name: "result",
        enter: async (page) => {
          await choose(page, "rich.pdf", read("metadata-rich.pdf"));
          await heading(page, "Cleaned PDF ready");
        },
        moved: true,
        announces: true,
      },
      {
        name: "a file that cannot be opened",
        enter: async (page) => {
          await choose(page, "damaged.pdf", CORRUPT);
          await alert(page);
        },
        moved: true,
        announces: true,
      },
    ],
  ],
];

for (const [route, scenes] of TOOL_SCENES)
  test(`${route} is usable without a mouse, by a screen reader, and when enlarged`, async ({
    page,
  }) => {
    await run(page, route, scenes);
  });

// ── Images to PDF ───────────────────────────────────────────────────────

async function images(page: Page, count: number) {
  const make = (color: string, type: "image/png" | "image/jpeg") =>
    page.evaluate(
      async ({ color, type }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 90;
        canvas.height = 60;
        const context = canvas.getContext("2d")!;
        context.fillStyle = color;
        context.fillRect(0, 0, 90, 60);
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((value) => resolve(value!), type, 0.9),
        );
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      },
      { color, type },
    );
  const specs = [
    ["one.jpg", "image/jpeg", "#a33"],
    ["two.png", "image/png", "#3a3"],
    ["three.jpg", "image/jpeg", "#33a"],
  ] as const;
  const files = [];
  for (const [name, type, color] of specs.slice(0, count))
    files.push({
      name,
      mimeType: type,
      buffer: Buffer.from(await make(color, type)),
    });
  await picker(page).setInputFiles(files);
  await expect(page.locator(".image-card img")).toHaveCount(count, {
    timeout: 30_000,
  });
}

test("/jpg-to-pdf is usable without a mouse, by a screen reader, and when enlarged", async ({
  page,
}) => {
  await run(page, "/jpg-to-pdf", [
    { name: "ready for images" },
    {
      name: "three images listed",
      enter: (p) => images(p, 3),
      moved: true,
    },
    {
      name: "an image that is not one",
      enter: async (p) => {
        await picker(p).setInputFiles({
          name: "notes.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("not an image"),
        });
        await alert(p);
      },
      moved: true,
      announces: true,
    },
    {
      name: "result",
      enter: async (p) => {
        await images(p, 3);
        await p.getByRole("button", { name: "Create PDF" }).click();
        await heading(p, "Your image PDF is ready");
      },
      moved: true,
      announces: true,
    },
  ]);
});

// ── Word to PDF (a scripted processor) ──────────────────────────────────

test.describe("Word to PDF", () => {
  test.use({ allowProcessorRequests: true });

  const DOCX =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const PDF_OUT = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n" +
      "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
      "0000000058 00000 n \n0000000115 00000 n \n" +
      "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF\n",
  );

  async function processor(page: Page, convert: "ok" | "unreadable") {
    await page.route("**/api/processor/jobs**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(
        /^.*\/api\/processor/,
        "",
      );
      const json = (status: number, body: unknown) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (request.method() === "POST" && path === "/jobs")
        return json(201, { id: "job-1", token: "token-1", state: "created" });
      if (request.method() === "PUT") return json(200, { status: "ok" });
      if (request.method() === "POST" && path.endsWith("/convert"))
        return convert === "ok"
          ? json(200, {
              id: "job-1",
              tool: "word-to-pdf",
              state: "succeeded",
              input_bytes: 100,
              output_bytes: PDF_OUT.length,
              error_code: null,
            })
          : json(422, {
              detail: { code: "conversion_failed", message: "ignored" },
            });
      if (request.method() === "GET" && path.endsWith("/output"))
        return route.fulfill({
          status: 200,
          contentType: PDF,
          body: PDF_OUT,
        });
      if (request.method() === "DELETE") return route.fulfill({ status: 204 });
      return route.fallback();
    });
  }
  const docx = {
    name: "report.docx",
    mimeType: DOCX,
    buffer: Buffer.alloc(256, 1),
  };

  test("/word-to-pdf is usable without a mouse, by a screen reader, and when enlarged", async ({
    page,
  }) => {
    await run(page, "/word-to-pdf", [
      { name: "ready for a file" },
      {
        name: "a document chosen",
        enter: async (p) => {
          await processor(p, "ok");
          await picker(p).setInputFiles(docx);
          await expect(
            p.getByRole("button", { name: "Convert to PDF" }),
          ).toBeEnabled();
        },
      },
      {
        name: "a file that is not a .docx",
        enter: async (p) => {
          await picker(p).setInputFiles({
            name: "old.doc",
            mimeType: "application/msword",
            buffer: Buffer.alloc(64, 1),
          });
          await alert(p);
        },
        moved: true,
        announces: true,
      },
      {
        name: "a document the converter cannot read",
        enter: async (p) => {
          await processor(p, "unreadable");
          await picker(p).setInputFiles(docx);
          await p.getByRole("button", { name: "Convert to PDF" }).click();
          await alert(p);
        },
        moved: true,
        announces: true,
      },
      {
        name: "result",
        enter: async (p) => {
          await processor(p, "ok");
          await picker(p).setInputFiles(docx);
          await p.getByRole("button", { name: "Convert to PDF" }).click();
          await heading(p, "Your PDF is ready");
        },
        moved: true,
        announces: true,
      },
    ]);
  });
});

// ── Pages without a tool ────────────────────────────────────────────────

const STATIC_PAGES = [
  "/",
  "/tools",
  "/about",
  "/privacy",
  "/terms",
  "/contact",
  "/learn",
  "/learn/copy-text-from-a-pdf",
  "/learn/make-a-pdf-smaller",
  "/learn/merge-pdfs-without-uploading",
  "/learn/photos-and-scans-into-one-pdf",
  "/learn/save-pdf-pages-as-images",
  "/learn/split-a-pdf-or-keep-some-pages",
  "/learn/what-processed-on-your-device-means",
  "/learn/whats-hidden-in-a-pdf",
];

test("every page without a tool is usable without a mouse, by a screen reader, and when enlarged", async ({
  page,
}) => {
  for (const route of STATIC_PAGES)
    await run(page, route, [{ name: "as loaded" }]);
  await run(page, "/tools", [
    {
      name: "search results",
      enter: async (p) => {
        await p.getByRole("searchbox", { name: "Find a tool" }).fill("merge");
        await expect(p.getByRole("status")).toContainText("tool");
      },
      announces: true,
    },
    {
      name: "search with no result",
      enter: async (p) => {
        await p
          .getByRole("searchbox", { name: "Find a tool" })
          .fill("nonexistent task");
        await expect(p.getByRole("status")).toContainText(/no|0/i);
      },
      announces: true,
    },
  ]);
});

test("a page that does not exist is usable without a mouse, by a screen reader, and when enlarged", async ({
  page,
}) => {
  await test.step("/no-such-page", async () => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    expect
      .soft(await audit(page, { name: "404" }), "/no-such-page")
      .toEqual([]);
  });
});

// ── Whole-site rules ────────────────────────────────────────────────────

test("every page has its own title, a language, one main landmark and a working skip link", async ({
  page,
}) => {
  const titles = new Map<string, string>();
  const routes = [
    ...STATIC_PAGES,
    "/merge-pdf",
    "/organize-pdf",
    "/extract-pdf-pages",
    "/delete-pdf-pages",
    "/rotate-pdf",
    "/split-pdf",
    "/jpg-to-pdf",
    "/pdf-to-jpg",
    "/pdf-to-text",
    "/remove-pdf-metadata",
    "/compress-pdf",
    "/word-to-pdf",
  ];
  for (const route of routes) {
    await page.goto(route);
    const facts = await page.evaluate(() => ({
      title: document.title.trim(),
      lang: document.documentElement.lang,
      mains: document.querySelectorAll("main, [role='main']").length,
      h1s: document.querySelectorAll("h1").length,
    }));
    expect.soft(facts.title, `${route}: title`).not.toBe("");
    expect.soft(facts.lang, `${route}: language`).toBe("en");
    expect.soft(facts.mains, `${route}: main landmarks`).toBe(1);
    expect.soft(facts.h1s, `${route}: top-level headings`).toBe(1);
    const other = titles.get(facts.title);
    expect
      .soft(other, `${route}: shares its title with ${other}`)
      .toBeUndefined();
    titles.set(facts.title, route);
  }

  // Bypass blocks: the first Tab stop is the skip link, and it works.
  await page.goto("/");
  await page.evaluate(() => {
    document.getSelection()?.collapse(document.body, 0);
  });
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect.soft(skip).toBeFocused();
  await expect.soft(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect.soft(page.locator("#main-content")).toBeFocused();
});
