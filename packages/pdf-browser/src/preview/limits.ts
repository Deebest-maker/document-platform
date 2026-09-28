// Engineering bounds, measured in M2B. These constrain owned canvas storage,
// not PDF.js's decoded images, fonts, browser caches or total process memory.
export const thumbnailLimits = Object.freeze({
  width: 240,
  height: 320,
  maxDpr: 2,
  maxPixels: 307200,
  concurrency: 1,
  maxRetained: 8,
  maxQueued: 12,
});
