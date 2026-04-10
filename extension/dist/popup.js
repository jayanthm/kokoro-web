const selectionBox = document.getElementById("selection-box");
const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const statusEl = document.getElementById("status");
document.getElementById("download-section");
const downloadBtn = document.getElementById("download-btn");
const downloadStatus = document.getElementById("download-status");
const progressBar = document.getElementById("progress-bar");
const progressFill = document.getElementById("progress-fill");
let state = "idle";
let currentText = "";
let modelReady = false;
function setState(newState, statusMsg = "") {
  state = newState;
  statusEl.className = `status ${newState === "idle" ? "" : newState}`;
  statusEl.textContent = statusMsg;
  const hasText = currentText.length > 0;
  switch (newState) {
    case "idle":
      playBtn.style.display = "flex";
      stopBtn.style.display = "none";
      playBtn.disabled = !hasText || !modelReady;
      playBtn.textContent = "▶ Read aloud";
      break;
    case "loading":
      playBtn.style.display = "flex";
      stopBtn.style.display = "none";
      playBtn.disabled = true;
      playBtn.textContent = "⏳ Loading…";
      break;
    case "playing":
      playBtn.style.display = "none";
      stopBtn.style.display = "flex";
      break;
  }
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function setDownloadReady() {
  modelReady = true;
  downloadStatus.textContent = "Ready";
  downloadStatus.className = "download-status ready";
  downloadBtn.style.display = "none";
  progressBar.style.display = "none";
  if (currentText.length > 0 && state === "idle") {
    playBtn.disabled = false;
  }
}
function setDownloadNeeded() {
  modelReady = false;
  downloadStatus.textContent = "Not downloaded";
  downloadStatus.className = "download-status";
  downloadBtn.style.display = "block";
  downloadBtn.disabled = false;
  downloadBtn.textContent = "Download model (~87 MB)";
  progressBar.style.display = "none";
  playBtn.disabled = true;
}
function setDownloadProgress(downloaded, total, label) {
  downloadStatus.textContent = `${label}: ${formatBytes(downloaded)} / ${formatBytes(total)}`;
  downloadStatus.className = "download-status downloading";
  progressBar.style.display = "block";
  const pct = total > 0 ? Math.round(downloaded / total * 100) : 0;
  progressFill.style.width = `${pct}%`;
}
function setDownloadError(error) {
  downloadStatus.textContent = error;
  downloadStatus.className = "download-status error";
  downloadBtn.disabled = false;
  downloadBtn.textContent = "Retry download";
  progressBar.style.display = "none";
}
downloadBtn.addEventListener("click", () => {
  downloadBtn.disabled = true;
  downloadBtn.textContent = "Downloading…";
  downloadStatus.textContent = "Starting…";
  downloadStatus.className = "download-status downloading";
  progressBar.style.display = "block";
  progressFill.style.width = "0%";
  chrome.runtime.sendMessage({ target: "background", type: "PRELOAD" });
});
async function loadSelection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) return;
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "GET_SELECTION"
    });
    const text = response?.text ?? "";
    currentText = text.slice(0, 2e3);
    if (currentText) {
      selectionBox.textContent = currentText;
      selectionBox.classList.remove("empty");
    } else {
      selectionBox.textContent = "No text selected — select text on the page first";
      selectionBox.classList.add("empty");
    }
    setState("idle");
  } catch {
    selectionBox.textContent = "Not available on this page";
    selectionBox.classList.add("empty");
    playBtn.disabled = true;
  }
}
playBtn.addEventListener("click", async () => {
  if (state !== "idle" || !currentText) return;
  setState("loading", "Starting…");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) throw new Error("No active tab");
    chrome.runtime.sendMessage({
      target: "background",
      type: "TTS_SPEAK",
      text: currentText
    });
  } catch (err) {
    setState("idle");
    statusEl.className = "status error";
    statusEl.textContent = "Failed to start — reload the page and try again";
  }
});
stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ target: "background", type: "TTS_STOP" });
  setState("idle");
});
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case "TTS_STARTED":
      setState("playing", "Playing…");
      break;
    case "TTS_DONE":
      setState("idle", "Done");
      setTimeout(() => {
        if (statusEl.textContent === "Done") statusEl.textContent = "";
      }, 2e3);
      break;
    case "TTS_ERROR":
      setState("idle");
      statusEl.className = "status error";
      statusEl.textContent = msg.error || "Error";
      break;
    // Preload / cache status
    case "CACHE_STATUS":
      if (msg.modelCached && msg.voiceCached) {
        setDownloadReady();
      } else {
        setDownloadNeeded();
      }
      break;
    case "PRELOAD_PROGRESS":
      setDownloadProgress(msg.downloaded, msg.total, msg.label);
      break;
    case "PRELOAD_DONE":
      setDownloadReady();
      break;
    case "PRELOAD_ERROR":
      setDownloadError(msg.error || "Download failed");
      break;
  }
});
loadSelection();
chrome.runtime.sendMessage({ target: "background", type: "CHECK_CACHE" });
