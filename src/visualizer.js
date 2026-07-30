/**
 * @file visualizer.js
 * @description HTML5 Canvas rendering engine for camera video frame mirroring, MediaPipe landmark overlay,
 * and audio wave energy animation with dynamic color shifts based on detected scales and tilt.
 */

/**
 * Computes source crop dimensions to achieve a CSS object-fit: cover effect on canvas.
 *
 * @param {number} srcW Video element width.
 * @param {number} srcH Video element height.
 * @param {number} dstW Canvas container width.
 * @param {number} dstH Canvas container height.
 * @returns {Object} Source rect dimensions { sx, sy, sWidth, sHeight }.
 */
export function computeCoverRect(srcW, srcH, dstW, dstH) {
  const srcRatio = srcW / srcH;
  const dstRatio = dstW / dstH;

  if (srcRatio > dstRatio) {
    const sHeight = srcH;
    const sWidth = srcH * dstRatio;
    return { sx: (srcW - sWidth) / 2, sy: 0, sWidth, sHeight };
  } else {
    const sWidth = srcW;
    const sHeight = srcW / dstRatio;
    return { sx: 0, sy: (srcH - sHeight) / 2, sWidth, sHeight };
  }
}

/**
 * Draws mirrored camera frame and MediaPipe hand landmark tracking points on the canvas overlay.
 *
 * @param {HTMLVideoElement} videoEl HTML webcam video element.
 * @param {CanvasRenderingContext2D} ctx Canvas 2D context.
 * @param {Object} results MediaPipe HandLandmarker detection results.
 * @param {number} canvasWidth Target canvas width.
 * @param {number} canvasHeight Target canvas height.
 */
export function drawFrame(videoEl, ctx, results, canvasWidth, canvasHeight) {
  const srcW = videoEl.videoWidth;
  const srcH = videoEl.videoHeight;
  if (!srcW || !srcH) return;

  const { sx, sy, sWidth, sHeight } = computeCoverRect(srcW, srcH, canvasWidth, canvasHeight);

  ctx.save();
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.translate(canvasWidth, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(videoEl, sx, sy, sWidth, sHeight, 0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = "#ffffff80";
  for (const landmarks of results.landmarks) {
    for (const point of landmarks) {
      const videoPx = point.x * srcW;
      const videoPy = point.y * srcH;
      const canvasX = ((videoPx - sx) / sWidth) * canvasWidth;
      const canvasY = ((videoPy - sy) / sHeight) * canvasHeight;

      ctx.beginPath();
      ctx.arc(canvasX, canvasY, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Renders animated audio energy waves with color matching active scale degrees and jitter driven by tilt.
 *
 * @param {CanvasRenderingContext2D} ctx Canvas 2D context.
 * @param {number} volume01 Normalized height volume level (0.0 to 1.0).
 * @param {number} qualityIndex Voicing quality line count (0 to 4).
 * @param {number} tiltFactor Horizontal tilt factor (-1.0 to +1.0).
 * @param {string|null} chordStr Active Roman numeral chord string.
 */
export function drawEnergy(ctx, volume01, qualityIndex, tiltFactor, chordStr) {
  if (!ctx) return;
  if (qualityIndex === 0) return;
  const lineCount = qualityIndex;

  try {
    const centerY = ctx.canvas.height - 56;
    const canvasWidth = ctx.canvas.width;
    const maxThickness = 1 + (volume01 * 8);

    const chaosScale = (tiltFactor + 1) / 2;
    const shakinessAmp = chaosScale * 25;
    const shakinessFreq = 0.05 + (chaosScale * 0.15);

    let baseColorRGB = "150, 150, 150";
    let isChordActive = false;
    let isMajor = false;

    if (chordStr && chordStr !== "--") {
      isChordActive = true;
      const upperStr = chordStr.toUpperCase();
      isMajor = (chordStr === upperStr);

      const SCALE_COLORS = {
        "I":   "232, 161, 61",
        "II":  "210, 50, 120",
        "III": "180, 40, 150",
        "IV":  "240, 210, 40",
        "V":   "245, 120, 30",
        "VI":  "230, 40, 40",
        "VII": "100, 200, 250"
      };
      baseColorRGB = SCALE_COLORS[upperStr] || "232, 161, 61";
    }

    const brightnessAlpha = isChordActive ? (isMajor ? 1 : 0.70) : 0.3;

    ctx.save();
    const time = performance.now() * 0.004;
    const colorChannels = baseColorRGB.split(",");
    const r = parseInt(colorChannels[0]);
    const g = parseInt(colorChannels[1]);
    const b = parseInt(colorChannels[2]);

    ctx.shadowBlur = 10 + (volume01 * 20);
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${0.5 * brightnessAlpha})`;

    for (let l = 0; l < lineCount; l++) {
      ctx.beginPath();
      const lineYOffset = centerY + (l - (lineCount - 1) / 2) * 12;

      for (let x = 0; x <= canvasWidth; x += 10) {
        const baseSine = Math.sin(x * 0.005 + time + l * 0.5) * 20;
        const jitter = (Math.random() - 0.5) * shakinessAmp * Math.sin(x * shakinessFreq + time);
        const y = lineYOffset + baseSine + jitter;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${brightnessAlpha})`;
      ctx.lineWidth = Math.max(1, maxThickness - (l * 0.5));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.restore();
  } catch (error) {
    console.error("Wave animation failed:", error);
  }
}
