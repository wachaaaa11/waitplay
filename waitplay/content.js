/**
 * WaitPlay content script.
 *
 * Listens for "waitplay-show" / "waitplay-stop" messages from the
 * background service worker and manages a small overlay card that can
 * host a simple falling-stars canvas game while a slow network request
 * is in flight.
 */

(function () {
  if (window.__waitplayInjected) return;
  window.__waitplayInjected = true;

  const CANVAS_W = 236;
  const CANVAS_H = 150;

  let overlayEl = null;
  let trackedRequestId = null;
  let state = "idle"; // idle | prompt | playing | result

  let game = null; // holds animation frame id, listeners, etc. while playing

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return;

    if (message.type === "waitplay-show") {
      if (state !== "idle") return; // already showing something
      trackedRequestId = message.requestId;
      showPrompt();
    } else if (message.type === "waitplay-stop") {
      if (message.requestId !== trackedRequestId) return;
      onRequestFinished(message.reason);
    }
  });

  function releaseTracking() {
    trackedRequestId = null;
    chrome.runtime.sendMessage({ type: "waitplay-release" });
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = "waitplay-overlay";
    document.documentElement.appendChild(overlayEl);
    return overlayEl;
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    state = "idle";
  }

  function closeAndRelease() {
    stopGameLoopIfRunning();
    removeOverlay();
    releaseTracking();
  }

  // ---------- Prompt view ----------

  function showPrompt() {
    state = "prompt";
    const el = ensureOverlay();
    el.innerHTML = `
      <div class="waitplay-header">
        <span>WaitPlay</span>
        <button class="waitplay-close" type="button" title="Dismiss">✕</button>
      </div>
      <div class="waitplay-body">
        <p class="waitplay-text">A request is taking a while. Play a quick mini-game while you wait?</p>
        <div class="waitplay-actions">
          <button class="waitplay-btn waitplay-btn-secondary" type="button" data-action="dismiss">Not now</button>
          <button class="waitplay-btn waitplay-btn-primary" type="button" data-action="play">Play</button>
        </div>
      </div>
    `;

    el.querySelector(".waitplay-close").addEventListener("click", closeAndRelease);
    el.querySelector('[data-action="dismiss"]').addEventListener("click", closeAndRelease);
    el.querySelector('[data-action="play"]').addEventListener("click", startGame);
  }

  // ---------- Game view ----------

  function startGame() {
    state = "playing";
    const el = ensureOverlay();
    el.innerHTML = `
      <div class="waitplay-header">
        <span>WaitPlay</span>
        <button class="waitplay-close" type="button" title="Close">✕</button>
      </div>
      <div class="waitplay-body waitplay-canvas-wrap">
        <div class="waitplay-score-row">
          <span>Score: <span id="waitplay-score">0</span></span>
          <span id="waitplay-status">catching...</span>
        </div>
        <canvas id="waitplay-canvas" width="${CANVAS_W}" height="${CANVAS_H}"></canvas>
        <p class="waitplay-hint">← → or A / D to move &middot; catch the stars</p>
      </div>
    `;

    el.querySelector(".waitplay-close").addEventListener("click", closeAndRelease);

    const canvas = el.querySelector("#waitplay-canvas");
    const ctx = canvas.getContext("2d");
    const scoreEl = el.querySelector("#waitplay-score");

    const keys = { left: false, right: false };

    const onKeyDown = (e) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
        keys.left = true;
        e.preventDefault();
      } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
        keys.right = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);

    const paddle = {
      w: 34,
      h: 6,
      x: CANVAS_W / 2 - 17,
      y: CANVAS_H - 12,
      speed: 180 // px per second
    };

    let stars = [];
    let score = 0;
    let spawnTimer = 0;
    let spawnInterval = 900; // ms, gets slightly faster over time
    let lastTs = null;
    let rafId = null;

    function spawnStar() {
      stars.push({
        x: 8 + Math.random() * (CANVAS_W - 16),
        y: -6,
        r: 3 + Math.random() * 2,
        speed: 40 + Math.random() * 50
      });
    }

    function update(dt) {
      if (keys.left) paddle.x -= paddle.speed * dt;
      if (keys.right) paddle.x += paddle.speed * dt;
      paddle.x = Math.max(0, Math.min(CANVAS_W - paddle.w, paddle.x));

      spawnTimer += dt * 1000;
      if (spawnTimer >= spawnInterval) {
        spawnTimer = 0;
        spawnStar();
        spawnInterval = Math.max(380, spawnInterval - 12);
      }

      for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i];
        s.y += s.speed * dt;

        const caught =
          s.y + s.r >= paddle.y &&
          s.y - s.r <= paddle.y + paddle.h &&
          s.x >= paddle.x - s.r &&
          s.x <= paddle.x + paddle.w + s.r;

        if (caught) {
          score += 1;
          scoreEl.textContent = String(score);
          stars.splice(i, 1);
        } else if (s.y - s.r > CANVAS_H) {
          stars.splice(i, 1); // missed, no penalty - keep it low-pressure
        }
      }
    }

    function drawStar(cx, cy, r) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outerAngle = (Math.PI / 2.5) * i - Math.PI / 2;
        const innerAngle = outerAngle + Math.PI / 5;
        const ox = Math.cos(outerAngle) * r;
        const oy = Math.sin(outerAngle) * r;
        const ix = Math.cos(innerAngle) * (r / 2.2);
        const iy = Math.sin(innerAngle) * (r / 2.2);
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      ctx.fillStyle = "#ffd66b";
      ctx.fill();
      ctx.restore();
    }

    function draw() {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.fillStyle = "#6b7bd6";
      ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);

      for (const s of stars) drawStar(s.x, s.y, s.r);
    }

    function loop(ts) {
      if (lastTs === null) lastTs = ts;
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;

      update(dt);
      draw();

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);

    game = {
      getScore: () => score,
      stop() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        document.removeEventListener("keydown", onKeyDown, true);
        document.removeEventListener("keyup", onKeyUp, true);
      }
    };
  }

  function stopGameLoopIfRunning() {
    if (game) {
      game.stop();
      game = null;
    }
  }

  // ---------- Result view ----------

  function onRequestFinished(reason) {
    if (state === "playing") {
      const finalScore = game ? game.getScore() : 0;
      stopGameLoopIfRunning();
      showResult(finalScore, reason);
    } else {
      // Prompt was still showing (or something odd) - just clean up quietly.
      removeOverlay();
      releaseTracking();
    }
  }

  function showResult(score, reason) {
    state = "result";
    const el = ensureOverlay();
    const message =
      reason === "error" ? "The request failed. Here's how you did:" : "The page finished loading. Here's how you did:";

    el.innerHTML = `
      <div class="waitplay-header">
        <span>WaitPlay</span>
        <button class="waitplay-close" type="button" title="Close">✕</button>
      </div>
      <div class="waitplay-body">
        <p class="waitplay-result-title">${message}</p>
        <p class="waitplay-result-score">${score} caught</p>
        <div class="waitplay-actions">
          <button class="waitplay-btn waitplay-btn-primary" type="button" data-action="close">Close</button>
        </div>
      </div>
    `;

    el.querySelector(".waitplay-close").addEventListener("click", closeAndRelease);
    el.querySelector('[data-action="close"]').addEventListener("click", closeAndRelease);

    // Auto-dismiss after a while if the user doesn't interact.
    setTimeout(() => {
      if (state === "result") closeAndRelease();
    }, 8000);
  }
})();
