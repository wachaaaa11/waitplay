# WaitPlay

A minimal Manifest V3 Chrome extension. It watches outgoing XHR/fetch
requests on the page. If one stays in flight for 5 seconds, it drops a
small, dismissible overlay in the bottom-right corner asking if you want
to play a quick falling-stars game while you wait. Click **Play** to
start; the game stops the instant the tracked request finishes (success
or failure) and shows your final score.

No backend, no external APIs/keys, no npm packages, no frameworks -
just `manifest.json` + two plain JS files + one CSS file.

## Files

- `manifest.json` - MV3 manifest (background service worker + content script)
- `background.js` - uses `chrome.webRequest` to time requests and message the tab
- `content.js` - injects/manages the overlay and the Canvas mini-game
- `overlay.css` - styling for the overlay card

## Load it

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this `waitplay` folder

## Try it

Open any page that makes a slow XHR/fetch request (>5s), or test with a
page that calls something like `https://httpbin.org/delay/8` via
`fetch()`. Within 5 seconds of the request starting, the overlay
appears. Click **Play**, use `←/→` or `A/D` to move the paddle and
catch falling stars. When the request resolves or fails, the game
freezes immediately and your score is shown.

## Notes / limitations

- Only one overlay/game runs per tab at a time; if several slow requests
  overlap, the first one tracked drives the overlay and the rest are
  ignored until it's resolved.
- Requests are tracked with `chrome.webRequest`'s `xmlhttprequest` type,
  which covers both `XMLHttpRequest` and `fetch()` calls.
- The 5-second timer lives in the background service worker via
  `setTimeout`. This is simple and reliable for short (5s) windows, but
  note that MV3 service workers can be recycled during longer idle
  periods - not a concern at this timescale.
- Navigating the tab to a new page (or closing it) clears any in-flight
  tracking for that tab so stale timers can't fire into a fresh page.
