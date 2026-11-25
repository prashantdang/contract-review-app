(function () {
  "use strict";

  // n8n webhook that answers questions about the uploaded contract.
  // It receives multipart/form-data with two fields:
  //   file    – the uploaded PDF
  //   message – the user's question
  // and returns { "response": string, "citation": string[], "reasoning": string }.
  // The address lives in config.js, which is kept out of Git (see config.example.js).
  const WEBHOOK_URL = (window.APP_CONFIG && window.APP_CONFIG.WEBHOOK_URL) || "";
  const REQUEST_TIMEOUT_MS = 120000;

  // ---------- Contract upload & preview ----------
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const viewer = document.getElementById("viewer");
  const pdfFrame = document.getElementById("pdfFrame");
  const fileName = document.getElementById("fileName");
  const fileDetail = document.getElementById("fileDetail");
  const replaceBtn = document.getElementById("replaceBtn");
  const topUploadBtn = document.getElementById("topUploadBtn");
  const uploadError = document.getElementById("uploadError");

  let currentUrl = null;
  let currentFile = null;

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function isPdf(file) {
    return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  }

  function showError(message) {
    uploadError.textContent = message;
    dropZone.hidden = false;
    viewer.hidden = true;
  }

  function showFile(file) {
    if (!file) return;
    if (!isPdf(file)) {
      showError("That file isn't a PDF. Please upload a .pdf contract.");
      return;
    }
    uploadError.textContent = "";

    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = URL.createObjectURL(file);
    currentFile = file;

    // The browser's built-in PDF viewer renders the file and scrolls on its own.
    pdfFrame.src = currentUrl + "#navpanes=0&view=FitH";
    fileName.textContent = file.name;
    fileName.title = file.name;
    fileDetail.textContent = formatSize(file.size) + " · Uploaded just now";

    dropZone.hidden = true;
    viewer.hidden = false;
    replaceBtn.hidden = false;
    updateSendState();
  }

  function openPicker() { fileInput.click(); }

  dropZone.addEventListener("click", openPicker);
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });
  replaceBtn.addEventListener("click", openPicker);
  topUploadBtn.addEventListener("click", openPicker);

  fileInput.addEventListener("change", () => {
    showFile(fileInput.files[0]);
    fileInput.value = ""; // allow re-selecting the same file
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    })
  );
  dropZone.addEventListener("drop", (e) => showFile(e.dataTransfer.files[0]));

  // Stop the browser from navigating away when a file is dropped outside the drop zone.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  // ---------- Chat ----------
  const messages = document.getElementById("messages");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");
  const hint = document.getElementById("hint");
  const chips = document.querySelectorAll(".chip");

  let waiting = false;

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text; // always text, never HTML from the server
    return node;
  }

  function addRow(role) {
    const row = el("div", "msg " + (role === "user" ? "msg-user" : "msg-ai"));
    if (role !== "user") {
      const avatar = el("span", "avatar", "AI");
      avatar.setAttribute("aria-hidden", "true");
      row.appendChild(avatar);
    }
    const bubble = el("div", "bubble");
    row.appendChild(bubble);
    messages.appendChild(row);
    scrollToBottom();
    return bubble;
  }

  function addUserMessage(text) {
    addRow("user").textContent = text;
  }

  function addTypingIndicator() {
    const bubble = addRow("ai");
    bubble.innerHTML =
      '<span class="typing" aria-label="Assistant is typing"><span></span><span></span><span></span></span>';
    return bubble;
  }

  // Fill an assistant bubble with the webhook's answer, sources and reasoning.
  function renderAnswer(bubble, answer) {
    bubble.textContent = "";
    bubble.appendChild(el("p", "answer", answer.response));

    if (answer.citation.length) {
      const block = el("div", "sources");
      block.appendChild(el("p", "meta-label", answer.citation.length === 1 ? "Source" : "Sources"));
      const list = el("ol", "citations");
      answer.citation.forEach((c) => list.appendChild(el("li", "citation", c)));
      block.appendChild(list);
      bubble.appendChild(block);
    }

    if (answer.reasoning) {
      const block = el("div", "reasoning");
      block.appendChild(el("p", "meta-label", "Why"));
      block.appendChild(el("p", "reasoning-text", answer.reasoning));
      bubble.appendChild(block);
    }
  }

  function renderError(bubble, message) {
    bubble.textContent = "";
    bubble.classList.add("bubble-error");
    bubble.appendChild(el("p", "answer", message));
  }

  // Check the webhook JSON and give back { response, citation[], reasoning }.
  function normalizeAnswer(data) {
    // n8n sometimes wraps the item in an array.
    if (Array.isArray(data)) data = data[0];
    if (!data || typeof data !== "object" || typeof data.response !== "string") {
      throw new Error("The webhook replied, but not in the expected format.");
    }
    const citation = Array.isArray(data.citation)
      ? data.citation.filter((c) => typeof c === "string" && c.trim() !== "")
      : [];
    const reasoning = typeof data.reasoning === "string" ? data.reasoning.trim() : "";
    return { response: data.response.trim(), citation, reasoning };
  }

  async function askWebhook(file, message) {
    if (!WEBHOOK_URL) {
      throw new Error(
        "The assistant isn't set up yet. Copy config.example.js to config.js and add your webhook address."
      );
    }

    const form = new FormData();
    form.append("file", file, file.name);
    form.append("message", message);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(WEBHOOK_URL, { method: "POST", body: form, signal: controller.signal });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new Error("The request took too long and was cancelled. Please try again.");
      }
      throw new Error("Couldn't reach the contract assistant. Check your connection and try again.");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      if (res.status === 404 && WEBHOOK_URL.includes("/webhook-test/")) {
        throw new Error(
          "The assistant isn't listening right now (404). In n8n, click “Listen for test event” on the workflow, or switch to the production webhook URL."
        );
      }
      throw new Error("The contract assistant returned an error (" + res.status + "). Please try again.");
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error("The webhook replied, but its response wasn't valid JSON.");
    }
    return normalizeAnswer(data);
  }

  function updateSendState() {
    const hasText = chatInput.value.trim() !== "";
    sendBtn.disabled = waiting || !currentFile || !hasText;
    chips.forEach((chip) => (chip.disabled = waiting || !currentFile));
    hint.textContent = currentFile
      ? "Enter to send · Shift + Enter for a new line"
      : "Upload a contract to start asking questions";
  }

  function autoResize() {
    chatInput.style.height = "auto";
    chatInput.style.height = chatInput.scrollHeight + "px";
  }

  async function send(text) {
    text = text.trim();
    if (!text || waiting) return;
    if (!currentFile) {
      updateSendState();
      return;
    }

    addUserMessage(text);
    chatInput.value = "";
    autoResize();

    waiting = true;
    updateSendState();
    const bubble = addTypingIndicator();

    try {
      const answer = await askWebhook(currentFile, text);
      renderAnswer(bubble, answer);
    } catch (err) {
      renderError(bubble, err.message);
    } finally {
      waiting = false;
      updateSendState();
      scrollToBottom();
      chatInput.focus();
    }
  }

  chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    send(chatInput.value);
  });

  // Enter sends, Shift+Enter adds a new line.
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(chatInput.value);
    }
  });

  chatInput.addEventListener("input", () => {
    autoResize();
    updateSendState();
  });

  chips.forEach((chip) => chip.addEventListener("click", () => send(chip.textContent)));

  updateSendState();
})();
