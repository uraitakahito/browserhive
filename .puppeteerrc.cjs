// Puppeteer configuration.
// BrowserHive connects only to remote Chromium servers (chromium-server-docker),
// so the bundled Chromium is never used at runtime. Skip the download to avoid
// pulling ~150MB during `npm install`.
module.exports = {
  skipDownload: true,
};
