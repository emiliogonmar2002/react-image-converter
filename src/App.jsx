import { useMemo, useRef, useState, useEffect } from "react";
import "./App.css";

const TARGET_RATIO = 4 / 5;

const DEFAULTS = {
  gaussianBlurRadius: 40,

  shadowOpacity: 0.5,
  shadowOffsetX: 10,
  shadowOffsetY: 0,
  shadowBlur: 111,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);

    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };

    img.src = url;
  });
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

// ======================================================
// COVER FIT (Photoshop-like fill)
// ======================================================

function drawCover(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth ?? img.width;
  const ih = img.naturalHeight ?? img.height;

  const scale = Math.max(dw / iw, dh / ih);

  const sw = dw / scale;
  const sh = dh / scale;

  const sx = (iw - sw) / 2;
  const sy = (ih - sh) / 2;

  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// ======================================================
// MAIN CONVERSION
// ======================================================

async function convertTo45(imgEl, mode, options) {
  // =====================================================
  // SAFE MOBILE DIMENSIONS
  // Prevent iPhone canvas crashes
  // =====================================================

  const originalWidth = imgEl.naturalWidth ?? imgEl.width;
  const originalHeight = imgEl.naturalHeight ?? imgEl.height;

  const MAX_DIMENSION = 2500;

  let scaleDown = 1;

  if (originalHeight > MAX_DIMENSION) {
    scaleDown = MAX_DIMENSION / originalHeight;
  }

  const width = Math.round(originalWidth * scaleDown);
  const height = Math.round(originalHeight * scaleDown);

  if (width > height) {
    throw new Error(
      "Horizontal images are not supported. Please choose a vertical image.",
    );
  }

  // =====================================================
  // TARGET 4x5 SIZE
  // =====================================================

  let newWidth = Math.round(height * TARGET_RATIO);
  let newHeight = height;

  if (width > newWidth) {
    newWidth = width;
    newHeight = Math.round(width / TARGET_RATIO);
  }

  // =====================================================
  // BACKGROUND CANVAS
  // =====================================================

  const bgCanvas = document.createElement("canvas");

  bgCanvas.width = newWidth;
  bgCanvas.height = newHeight;

  const bgCtx = bgCanvas.getContext("2d");

  if (!bgCtx) {
    throw new Error("Canvas not supported");
  }

  // =====================================================
  // WHITE MODE
  // =====================================================

  if (mode === "white") {
    bgCtx.fillStyle = "#ffffff";

    bgCtx.fillRect(0, 0, newWidth, newHeight);
  }

  // =====================================================
  // BLUR MODE
  // =====================================================
  else if (mode === "blur") {
    // =====================================================
    // MOBILE SAFE BLUR
    // =====================================================

    const blurCanvas = document.createElement("canvas");

    blurCanvas.width = newWidth;
    blurCanvas.height = newHeight;

    const blurCtx = blurCanvas.getContext("2d");

    if (!blurCtx) {
      throw new Error("Canvas not supported");
    }

    // Slight zoom like Photoshop

    const zoomScale = 1.08;

    const drawW = newWidth * zoomScale;
    const drawH = newHeight * zoomScale;

    const offsetX = (newWidth - drawW) / 2;
    const offsetY = (newHeight - drawH) / 2;

    drawCover(blurCtx, imgEl, offsetX, offsetY, drawW, drawH);

    // Convert canvas into image for Safari compatibility

    const dataUrl = blurCanvas.toDataURL();

    const tempImg = await new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => resolve(img);

      img.onerror = reject;

      img.src = dataUrl;
    });

    // Draw blurred background

    bgCtx.save();

    bgCtx.filter = `blur(${options.gaussianBlurRadius}px) brightness(0.82)`;

    bgCtx.drawImage(tempImg, -40, -40, newWidth + 80, newHeight + 80);

    bgCtx.restore();
  } else {
    throw new Error("Invalid mode");
  }

  // =====================================================
  // FINAL CANVAS
  // =====================================================

  const canvas = document.createElement("canvas");

  canvas.width = newWidth;
  canvas.height = newHeight;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas not supported");
  }

  // Background

  ctx.drawImage(bgCanvas, 0, 0);

  // =====================================================
  // CENTER FOREGROUND IMAGE
  // =====================================================

  const pasteX = Math.floor((newWidth - width) / 2);

  const pasteY = Math.floor((newHeight - height) / 2);

  // =====================================================
  // SHADOW
  // =====================================================

  if (mode === "blur") {
    ctx.save();

    ctx.translate(
      pasteX + options.shadowOffsetX,
      pasteY + options.shadowOffsetY,
    );

    ctx.shadowColor = `rgba(0,0,0,${options.shadowOpacity})`;

    ctx.shadowBlur = options.shadowBlur;

    ctx.globalAlpha = 1;

    ctx.drawImage(imgEl, 0, 0, width, height);

    ctx.restore();
  }

  // =====================================================
  // MAIN IMAGE
  // =====================================================

  ctx.drawImage(imgEl, pasteX, pasteY, width, height);

  return canvas;
}

// ======================================================
// APP
// ======================================================

function App() {
  const fileInputRef = useRef(null);

  const downloadSectionRef = useRef(null);

  const [file, setFile] = useState(null);

  const [mode, setMode] = useState("white");

  const [busy, setBusy] = useState(false);

  const [error, setError] = useState("");

  const [inputPreviewUrl, setInputPreviewUrl] = useState("");

  const [outputPreviewUrl, setOutputPreviewUrl] = useState("");

  const [downloadUrl, setDownloadUrl] = useState("");

  const [downloadName, setDownloadName] = useState("converted.png");

  const [opts, setOpts] = useState(DEFAULTS);

  const canConvert = useMemo(() => !!file && !busy, [file, busy]);

  // =====================================================
  // CLEANUP OBJECT URLS
  // =====================================================

  useEffect(() => {
    return () => {
      if (inputPreviewUrl) {
        URL.revokeObjectURL(inputPreviewUrl);
      }

      if (outputPreviewUrl) {
        URL.revokeObjectURL(outputPreviewUrl);
      }

      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [inputPreviewUrl, outputPreviewUrl, downloadUrl]);

  // =====================================================
  // RESET OUTPUTS
  // =====================================================

  function resetOutputs() {
    setError("");

    if (outputPreviewUrl) {
      URL.revokeObjectURL(outputPreviewUrl);
    }

    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
    }

    setOutputPreviewUrl("");

    setDownloadUrl("");
  }

  // =====================================================
  // FILE PICKER
  // =====================================================

  async function onPickFile(e) {
    const f = e.target.files?.[0];

    resetOutputs();

    setFile(f ?? null);

    if (inputPreviewUrl) {
      URL.revokeObjectURL(inputPreviewUrl);
    }

    if (f) {
      setInputPreviewUrl(URL.createObjectURL(f));
    } else {
      setInputPreviewUrl("");
    }
  }

  // =====================================================
  // CONVERT
  // =====================================================

  async function onConvert() {
    if (!file) return;

    resetOutputs();

    setBusy(true);

    try {
      const imgEl = await loadImageFromFile(file);

      const safeOpts = {
        gaussianBlurRadius: clamp(Number(opts.gaussianBlurRadius) || 0, 0, 200),

        shadowOpacity: clamp(Number(opts.shadowOpacity) || 0, 0, 1),

        shadowOffsetX: Math.round(Number(opts.shadowOffsetX) || 0),

        shadowOffsetY: Math.round(Number(opts.shadowOffsetY) || 0),

        shadowBlur: clamp(Number(opts.shadowBlur) || 0, 0, 300),
      };

      const canvas = await convertTo45(imgEl, mode, safeOpts);

      const blob = await canvasToBlob(canvas, "image/png");

      if (!blob) {
        throw new Error("Failed to encode PNG");
      }

      const base = file.name.replace(/\.[^/.]+$/, "");

      const suffix =
        mode === "blur" ? "_IG_BLUR" : mode === "white" ? "_IG_WHITE" : "_IG";

      const outName = `${base}${suffix}.png`;

      const url = URL.createObjectURL(blob);

      setDownloadUrl(url);

      setOutputPreviewUrl(url);

      setDownloadName(outName);

      // =================================================
      // AUTO SCROLL
      // =================================================

      setTimeout(() => {
        downloadSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 120);
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <main className="app">
      {/* ========================================= */}
      {/* HEADER */}
      {/* ========================================= */}

      <header className="header">
        <div>
          <h1>Instagram 4×5 Converter</h1>

          <p className="subtitle">
            Convert vertical 4×6 photos into Instagram-ready 4×5 posts with
            white borders or cinematic blurred backgrounds.
          </p>
        </div>
      </header>

      {/* ========================================= */}
      {/* MAIN PANEL */}
      {/* ========================================= */}

      <div className="panel">
        {/* FILE PICKER */}

        <div className="row">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onPickFile}
          />
        </div>

        {/* MODES */}

        <div className="row">
          <div className="modes">
            <label>
              <input
                type="radio"
                name="mode"
                value="white"
                checked={mode === "white"}
                onChange={() => setMode("white")}
              />
              White borders
            </label>

            <label>
              <input
                type="radio"
                name="mode"
                value="blur"
                checked={mode === "blur"}
                onChange={() => setMode("blur")}
              />
              Blurred background + shadow
            </label>
          </div>
        </div>

        {/* SETTINGS */}

        {mode === "blur" && (
          <fieldset className="fieldset">
            <legend>Blur + shadow settings</legend>

            <div className="grid">
              <label>
                Gaussian blur radius
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={opts.gaussianBlurRadius}
                  onChange={(e) =>
                    setOpts((o) => ({
                      ...o,
                      gaussianBlurRadius: e.target.value,
                    }))
                  }
                />
              </label>

              <label>
                Shadow opacity (0-1)
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={opts.shadowOpacity}
                  onChange={(e) =>
                    setOpts((o) => ({
                      ...o,
                      shadowOpacity: e.target.value,
                    }))
                  }
                />
              </label>

              <label>
                Shadow offset X
                <input
                  type="number"
                  value={opts.shadowOffsetX}
                  onChange={(e) =>
                    setOpts((o) => ({
                      ...o,
                      shadowOffsetX: e.target.value,
                    }))
                  }
                />
              </label>

              <label>
                Shadow offset Y
                <input
                  type="number"
                  value={opts.shadowOffsetY}
                  onChange={(e) =>
                    setOpts((o) => ({
                      ...o,
                      shadowOffsetY: e.target.value,
                    }))
                  }
                />
              </label>

              <label>
                Shadow blur
                <input
                  type="number"
                  min="0"
                  max="300"
                  value={opts.shadowBlur}
                  onChange={(e) =>
                    setOpts((o) => ({
                      ...o,
                      shadowBlur: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
          </fieldset>
        )}

        {/* CONVERT BUTTON */}

        <div className="row actions">
          <button type="button" disabled={!canConvert} onClick={onConvert}>
            {busy ? "Converting…" : "Convert to 4×5"}
          </button>
        </div>

        {/* ERROR */}

        {error && <div className="error">{error}</div>}
      </div>

      {/* ========================================= */}
      {/* PREVIEW */}
      {/* ========================================= */}

      <section className="preview">
        <h2>Preview</h2>

        <div className="previewGrid">
          {/* ORIGINAL */}

          <div className="previewCard">
            <h3>Original</h3>

            {inputPreviewUrl ? (
              <img src={inputPreviewUrl} alt="Original preview" />
            ) : (
              <div className="placeholder">Choose an image to preview it</div>
            )}
          </div>

          {/* RESULT */}

          <div className="previewCard">
            <h3>Result</h3>

            {outputPreviewUrl ? (
              <img src={outputPreviewUrl} alt="Converted result preview" />
            ) : (
              <div className="placeholder">
                Click “Convert to 4×5” to generate the result
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ========================================= */}
      {/* DOWNLOAD */}
      {/* ========================================= */}

      {downloadUrl && (
        <section className="downloadSection" ref={downloadSectionRef}>
          <div className="downloadCard">
            <h2>Your Instagram-ready image is ready</h2>

            <p>
              Download your converted 4×5 PNG below and upload directly to
              Instagram.
            </p>

            <a
              className="downloadBigButton"
              href={downloadUrl}
              download={downloadName}
            >
              Download PNG
            </a>
          </div>
        </section>
      )}

      {/* ========================================= */}
      {/* FOOTER */}
      {/* ========================================= */}

      <footer className="footer">
        <a
          href="https://www.instagram.com/eg.figureshots/"
          target="_blank"
          rel="noopener noreferrer"
          className="instagramFooter"
        >
          <div className="instagramBadge">
            <img
              src="/Logo2025.png"
              alt="EG Figure Shots logo"
              className="instagramLogo"
            />

            <div className="instagramText">
              <span className="followLabel">Follow me</span>

              <span className="handle">@eg.figureshots</span>
            </div>
          </div>
        </a>
      </footer>
    </main>
  );
}

export default App;
