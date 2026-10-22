import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// scripts/ci-install-browser.sh is what keeps a stalled package mirror from
// failing the required check. It cannot be tried against a real mirror here, so
// these tests run it against a stand-in install command and stand-ins for the
// system tools it calls (pkill, dpkg, rm), in a throwaway directory.

const script = path.resolve(
  import.meta.dirname,
  "../../../scripts/ci-install-browser.sh",
);

const made: string[] = [];
afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

function run(installScript: string, limits: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "install-browser-"));
  made.push(dir);
  const bin = path.join(dir, "bin");
  const sources = path.join(dir, "sources");
  const temp = path.join(dir, "tmp");
  for (const folder of [bin, sources, temp]) mkdirSync(folder);
  for (const tool of ["pkill", "dpkg", "rm"])
    writeFileSync(
      path.join(bin, tool),
      `#!/bin/sh\necho "${tool} $*" >> "${dir}/tools.log"\n`,
    );
  // On a runner the script calls these through sudo, which ignores PATH.
  writeFileSync(path.join(bin, "sudo"), '#!/bin/sh\nexec "$@"\n');
  for (const tool of ["pkill", "dpkg", "rm", "sudo"])
    chmodSync(path.join(bin, tool), 0o755);
  writeFileSync(
    path.join(sources, "ubuntu.sources"),
    "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\n",
  );
  writeFileSync(
    path.join(sources, "microsoft-prod.list"),
    "deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n",
  );
  writeFileSync(path.join(dir, "count"), "0");
  writeFileSync(
    path.join(dir, "install.sh"),
    `n=$(cat "${dir}/count"); n=$((n+1)); echo $n > "${dir}/count"\n` +
      `echo "attempt-$n uses $(grep URIs "${sources}/ubuntu.sources")"\n` +
      installScript,
  );
  const result = spawnSync("bash", [script, "chromium"], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_TEMP: temp,
      APT_SOURCES_DIR: sources,
      INSTALL_LIMITS: limits,
      INSTALL_COMMAND: `bash "${dir}/install.sh"`,
    },
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    attempts: Number(readFileSync(path.join(dir, "count"), "utf8")),
    sources: readdirSync(sources),
    tools: existsSync(path.join(dir, "tools.log"))
      ? readFileSync(path.join(dir, "tools.log"), "utf8")
      : "",
  };
}

describe.skipIf(process.platform === "win32")("ci-install-browser.sh", () => {
  it("installs on the first attempt without touching the mirror or killing anything", () => {
    const result = run('echo "installed"\n', "10 10 10");
    expect(result.status).toBe(0);
    expect(result.attempts).toBe(1);
    expect(result.output).toContain("finished on attempt 1");
    expect(result.output).not.toContain("::warning");
    expect(result.output).toContain("mirror+file:/etc/apt/apt-mirrors.txt");
    expect(result.tools).not.toContain("pkill");
  });

  it("only keeps Ubuntu's own package sources", () => {
    const result = run('echo "installed"\n', "10 10 10");
    expect(result.sources).toEqual(["ubuntu.sources"]);
  });

  it("survives a stall and a quick failure, alternating mirrors, and says what happened", () => {
    const result = run(
      'if [ "$n" -eq 1 ]; then echo "Get:1 a stalled package"; sleep 30; fi\n' +
        'if [ "$n" -eq 2 ]; then echo "E: failed quickly"; exit 100; fi\n' +
        'echo "installed"\n',
      "2 4 4",
    );
    expect(result.status).toBe(0);
    expect(result.attempts).toBe(3);
    // Attempt 1 and 3 use the runner's mirror, attempt 2 the main archive.
    expect(result.output).toContain(
      "attempt-1 uses URIs: mirror+file:/etc/apt/apt-mirrors.txt",
    );
    expect(result.output).toContain(
      "attempt-2 uses URIs: http://archive.ubuntu.com/ubuntu/",
    );
    expect(result.output).toContain(
      "attempt-3 uses URIs: mirror+file:/etc/apt/apt-mirrors.txt",
    );
    // The last output of each failed attempt is on the check run.
    expect(result.output).toContain(
      "::warning title=Browser install attempt 1 failed (exit 124) - last output::Get:1 a stalled package",
    );
    expect(result.output).toContain(
      "::warning title=Browser install attempt 2 failed (exit 100) - last output::E: failed quickly",
    );
    // Package-manager leftovers are stopped after each failure.
    expect(result.tools.match(/pkill -9 -x apt-get/g)?.length).toBe(2);
    expect(result.tools).toContain("dpkg --configure -a");
  });

  it("fails the job, with the last output as an error, when every attempt fails", () => {
    const result = run('echo "E: always broken"; exit 100\n', "5 5 5");
    expect(result.status).toBe(1);
    expect(result.attempts).toBe(3);
    expect(result.output).toContain(
      "::error title=Browser install failed every attempt - last output::E: always broken",
    );
  });

  it("does not hang: a stalled attempt is cut off at its limit", () => {
    const started = Date.now();
    const result = run('echo "stalled"; sleep 60\n', "1 1 1");
    expect(result.status).toBe(1);
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});
