/**
 * @file Settings page smoke test, appended to the browser's config.js.
 * @license
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Only runs when SINE_SMOKE_RESULT is set (see scripts/smoke_test.sh). Opens
// about:preferences, checks that Sine injected its pane, writes the result as
// JSON to SINE_SMOKE_RESULT, then quits the browser.
if (Services.env.get("SINE_SMOKE_RESULT")) {
  const sineSmoke = {
    resultPath: Services.env.get("SINE_SMOKE_RESULT"),
    checks: {},
    done: false,

    sleep(ms) {
      const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    },

    log(message) {
      dump(`[sine-smoke] ${message}\n`);
    },

    async waitFor(name, check, timeout = 30000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          if (check()) {
            this.log(`PASS: ${name}`);
            this.checks[name] = true;
            return true;
          }
        } catch {
          // Not ready yet.
        }
        // Polling has to be sequential.
        // eslint-disable-next-line no-await-in-loop
        await this.sleep(250);
      }
      this.log(`FAIL: ${name}`);
      this.checks[name] = false;
      return false;
    },

    writeResult(data) {
      // IOUtils is not exposed to config.js, so use XPCOM directly.
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(this.resultPath);
      const stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(
        Ci.nsIFileOutputStream
      );
      // PR_WRONLY | PR_CREATE_FILE | PR_TRUNCATE
      const flags = 0x2a;
      stream.init(file, flags, 0o644, 0);
      const json = JSON.stringify(data, null, 2);
      stream.write(json, json.length);
      stream.close();
    },

    finish(error) {
      if (this.done) {
        return;
      }
      this.done = true;
      const passed = !error && Object.values(this.checks).every(Boolean);
      this.writeResult({
        passed,
        error: error ? String(error) : null,
        checks: this.checks,
        browser: Services.appinfo.name,
        version: Services.appinfo.version,
        buildID: Services.appinfo.appBuildID,
        sineFork: Services.prefs.getStringPref("sine.fork-id", ""),
      });
      Services.startup.quit(Ci.nsIAppStartup.eForceQuit);
    },

    async run(win) {
      await this.waitFor("sine loaded", () =>
        Cu.isESModuleLoaded("chrome://userscripts/content/sine.sys.mjs")
      );

      win.gBrowser.selectedTab = win.gBrowser.addTrustedTab("about:preferences");

      let doc;
      const opened = await this.waitFor("settings page opened", () => {
        doc = win.gBrowser.browsers
          .map((browser) => browser.contentDocument)
          .find((d) => /^about:(?:preferences|settings)/u.test(d?.documentURI));
        return doc?.readyState === "complete";
      });
      if (!opened) {
        this.log(`Open tabs: ${win.gBrowser.browsers.map((b) => b.currentURI.spec).join(", ")}`);
        return;
      }

      await this.waitFor("sine category injected", () => doc.querySelector("#category-sine-mods"));
      await this.waitFor("sine pane injected", () => doc.querySelector("#sineInstallationGroup"));
      if (Services.prefs.getStringPref("sine.fork-id", "") === "zen") {
        await this.waitFor(
          "zen mods category removed",
          () => !doc.querySelector("#category-zen-marketplace")
        );
      }
    },
  };

  const onStartup = (win) => {
    Services.obs.removeObserver(onStartup, "browser-delayed-startup-finished");
    sineSmoke
      .run(win)
      .then(
        () => sineSmoke.finish(),
        (err) => sineSmoke.finish(err)
      )
      .catch((err) => sineSmoke.log(`Error: ${err}`));
  };
  Services.obs.addObserver(onStartup, "browser-delayed-startup-finished");

  // Hard limit in case the browser never finishes starting up.
  sineSmoke
    .sleep(150000)
    .then(() => sineSmoke.finish("Timed out"))
    .catch((err) => sineSmoke.log(`Error: ${err}`));
}
