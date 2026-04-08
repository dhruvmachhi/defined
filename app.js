const STORAGE_KEY = "word-shelf-bookmarks-v1";
const APP_VERSION = "1.0.0";
const DICTIONARY_API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en/";

const state = {
  bookmarks: loadBookmarks(),
  draft: null,
  editingId: null,
  activeView: "lookup",
};

const elements = {
  panels: document.querySelectorAll(".panel"),
  tabButtons: document.querySelectorAll(".tabbar-button"),
  tabbar: document.querySelector("#tabbar"),
  backupFeedback: document.querySelector("#backup-feedback"),
  bookmarkCount: document.querySelector("#bookmark-count"),
  bookmarkEmpty: document.querySelector("#bookmark-empty"),
  bookmarkList: document.querySelector("#bookmark-list"),
  bookmarkTemplate: document.querySelector("#bookmark-template"),
  cancelButton: document.querySelector("#cancel-button"),
  customDefinition: document.querySelector("#custom-definition"),
  customExample: document.querySelector("#custom-example"),
  definitionOptions: document.querySelector("#definition-options"),
  exportButton: document.querySelector("#export-button"),
  importInput: document.querySelector("#import-input"),
  notesDetails: document.querySelector("#notes-details"),
  lookupButton: document.querySelector("#lookup-button"),
  lookupFeedback: document.querySelector("#lookup-feedback"),
  lookupForm: document.querySelector("#lookup-form"),
  phoneticChip: document.querySelector("#phonetic-chip"),
  previewWord: document.querySelector("#preview-word"),
  saveButton: document.querySelector("#save-button"),
  saveForm: document.querySelector("#save-form"),
  wordInput: document.querySelector("#word-input"),
  apiExamplesList: document.querySelector("#api-examples-list"),
  apiExamplesWrap: document.querySelector("#api-examples-wrap"),
};

init();

function init() {
  wireEvents();
  setActiveView(state.activeView);
  renderBookmarks();
  registerServiceWorker();
}

function wireEvents() {
  elements.lookupForm.addEventListener("submit", handleLookupSubmit);
  elements.saveForm.addEventListener("submit", handleSaveSubmit);
  elements.cancelButton.addEventListener("click", resetDraft);
  elements.exportButton.addEventListener("click", exportBookmarks);
  elements.importInput.addEventListener("change", importBookmarks);
  elements.tabbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view-target]");
    if (!button) return;
    setActiveView(button.dataset.viewTarget);
  });
}

async function handleLookupSubmit(event) {
  event.preventDefault();

  const word = elements.wordInput.value.trim().toLowerCase();
  if (!word) {
    setFeedback("Enter a word first.", "error");
    return;
  }

  setLookupBusy(true);
  setFeedback("Looking up...", "");

  try {
    const response = await fetch(`${DICTIONARY_API_BASE}${encodeURIComponent(word)}`);
    if (!response.ok) {
      throw new Error(response.status === 404 ? "No definition found for that word." : "Lookup failed.");
    }

    const payload = await response.json();
    const normalized = normalizeDictionaryEntry(word, payload);
    if (!normalized.definitions.length) {
      throw new Error("No clean definitions were returned for that word.");
    }

    state.draft = normalized;
    state.editingId = null;
    renderDraft();
    setActiveView("lookup");
    setFeedback("Select the meanings you want.", "success");
  } catch (error) {
    setFeedback(error.message || "Something went wrong while fetching the definition.", "error");
    resetDraft(false);
  } finally {
    setLookupBusy(false);
  }
}

function handleSaveSubmit(event) {
  event.preventDefault();

  if (!state.draft) {
    setFeedback("Look up a word before saving.", "error");
    return;
  }

  const selectedDefinitions = Array.from(
    elements.definitionOptions.querySelectorAll('input[type="checkbox"]:checked')
  )
    .map((input) => state.draft.definitions.find((item) => item.id === input.value))
    .filter(Boolean);

  const selectedExamples = Array.from(
    elements.apiExamplesList.querySelectorAll('input[type="checkbox"]:checked')
  )
    .map((input) => input.value)
    .filter(Boolean);

  const customDefinition = elements.customDefinition.value.trim();
  const customExample = elements.customExample.value.trim();

  if (!selectedDefinitions.length && !customDefinition && !customExample && !selectedExamples.length) {
    setFeedback("Add something to save first.", "error");
    return;
  }

  const now = new Date().toISOString();
  const existing = state.editingId
    ? state.bookmarks.find((bookmark) => bookmark.id === state.editingId)
    : null;

  const bookmark = {
    id: existing?.id || createId(),
    word: state.draft.word,
    phonetic: state.draft.phonetic || "",
    definitions: selectedDefinitions,
    customDefinition,
    customExample,
    apiExamples: selectedExamples,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (existing) {
    state.bookmarks = state.bookmarks.map((item) => (item.id === existing.id ? bookmark : item));
    setFeedback("Bookmark updated.", "success");
  } else {
    state.bookmarks.unshift(bookmark);
    setFeedback("Bookmark saved locally.", "success");
  }

  persistBookmarks();
  renderBookmarks();
  resetDraft(false);
  elements.lookupForm.reset();
  elements.wordInput.focus();
  setActiveView("bookmarks");
}

function renderDraft() {
  if (!state.draft) {
    elements.saveForm.hidden = true;
    return;
  }

  elements.previewWord.textContent = capitalizeWord(state.draft.word);
  elements.saveButton.textContent = state.editingId ? "Update" : "Save";

  if (state.draft.phonetic) {
    elements.phoneticChip.hidden = false;
    elements.phoneticChip.textContent = state.draft.phonetic;
  } else {
    elements.phoneticChip.hidden = true;
    elements.phoneticChip.textContent = "";
  }

  elements.definitionOptions.innerHTML = "";
  for (const definition of state.draft.definitions) {
    const label = document.createElement("label");
    label.className = "definition-option";

    const checkbox = document.createElement("input");
    checkbox.className = "definition-check";
    checkbox.type = "checkbox";
    checkbox.value = definition.id;
    checkbox.checked = Boolean(state.editingId);

    const copy = document.createElement("div");
    copy.className = "definition-copy";
    const meta = document.createElement("div");
    meta.className = "definition-meta";

    if (definition.partOfSpeech) {
      const chip = document.createElement("span");
      chip.className = "definition-tag";
      chip.textContent = definition.partOfSpeech;
      meta.appendChild(chip);
    }

    const text = document.createElement("p");
    text.className = "definition-text";
    text.textContent = definition.text;

    copy.append(meta, text);
    label.append(checkbox, copy);
    syncDefinitionSelection(label, checkbox);
    checkbox.addEventListener("change", () => syncDefinitionSelection(label, checkbox));
    elements.definitionOptions.appendChild(label);
  }

  renderApiExamples(state.draft.examples);
  elements.notesDetails.open = Boolean(state.editingId);

  if (!state.editingId) {
    elements.customDefinition.value = "";
    elements.customExample.value = "";
  }

  elements.saveForm.hidden = false;
}

function renderBookmarks() {
  const sorted = [...state.bookmarks].sort((a, b) => {
    const wordCompare = a.word.localeCompare(b.word, undefined, { sensitivity: "base" });
    if (wordCompare !== 0) return wordCompare;
    const dateA = new Date(a.updatedAt || a.createdAt).getTime();
    const dateB = new Date(b.updatedAt || b.createdAt).getTime();
    return dateB - dateA;
  });

  elements.bookmarkList.innerHTML = "";
  elements.bookmarkCount.textContent = `${sorted.length} saved`;
  elements.bookmarkEmpty.hidden = sorted.length > 0;
  elements.bookmarkList.hidden = sorted.length === 0;

  let currentLetter = "";
  let currentGroupList = null;

  for (const bookmark of sorted) {
    const nextLetter = bookmark.word.charAt(0).toUpperCase() || "#";
    if (nextLetter !== currentLetter) {
      currentLetter = nextLetter;
      const group = document.createElement("section");
      group.className = "bookmark-group";

      const label = document.createElement("div");
      label.className = "bookmark-group-label";
      label.textContent = /[A-Z]/.test(currentLetter) ? currentLetter : "#";

      currentGroupList = document.createElement("div");
      currentGroupList.className = "bookmark-group-list";

      group.append(label, currentGroupList);
      elements.bookmarkList.appendChild(group);
    }

    const fragment = elements.bookmarkTemplate.content.cloneNode(true);
    const root = fragment.querySelector(".bookmark-item");
    const word = fragment.querySelector(".bookmark-word");
    const date = fragment.querySelector(".bookmark-date");
    const definitions = fragment.querySelector(".saved-definitions");
    const ownMeaningWrap = fragment.querySelector(".own-meaning-wrap");
    const ownMeaning = fragment.querySelector(".own-meaning");
    const ownExampleWrap = fragment.querySelector(".own-example-wrap");
    const ownExample = fragment.querySelector(".own-example");
    const apiExampleWrap = fragment.querySelector(".api-example-wrap");
    const apiExampleList = fragment.querySelector(".api-example-list");
    const editButton = fragment.querySelector(".edit-bookmark");
    const deleteButton = fragment.querySelector(".delete-bookmark");

    root.dataset.id = bookmark.id;
    word.textContent = capitalizeWord(bookmark.word);
    date.textContent = `Saved ${formatDate(bookmark.createdAt)}`;

    for (const item of bookmark.definitions) {
      const li = document.createElement("li");
      li.textContent = item.text;
      definitions.appendChild(li);
    }
    definitions.hidden = bookmark.definitions.length === 0;

    if (bookmark.customDefinition) {
      ownMeaningWrap.hidden = false;
      ownMeaning.textContent = bookmark.customDefinition;
    }

    if (bookmark.customExample) {
      ownExampleWrap.hidden = false;
      ownExample.textContent = bookmark.customExample;
    }

    if (Array.isArray(bookmark.apiExamples) && bookmark.apiExamples.length) {
      apiExampleWrap.hidden = false;
      for (const example of bookmark.apiExamples) {
        const li = document.createElement("li");
        li.textContent = example;
        apiExampleList.appendChild(li);
      }
    }

    editButton.addEventListener("click", () => startEdit(bookmark.id));
    deleteButton.addEventListener("click", () => deleteBookmark(bookmark.id));

    currentGroupList.appendChild(fragment);
  }
}

function startEdit(id) {
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;

  state.editingId = id;
  state.draft = {
    word: bookmark.word,
    phonetic: bookmark.phonetic,
    definitions: bookmark.definitions.map((definition) => ({
      ...definition,
      id: definition.id || createId(),
    })),
    examples: bookmark.apiExamples || [],
  };

  renderDraft();
  elements.customDefinition.value = bookmark.customDefinition || "";
  elements.customExample.value = bookmark.customExample || "";
  elements.notesDetails.open = Boolean(bookmark.customDefinition || bookmark.customExample);
  elements.wordInput.value = bookmark.word;
  setActiveView("lookup");
  setFeedback(`Editing ${capitalizeWord(bookmark.word)}.`, "success");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function deleteBookmark(id) {
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;

  const confirmed = window.confirm(`Delete ${capitalizeWord(bookmark.word)}?`);
  if (!confirmed) return;

  state.bookmarks = state.bookmarks.filter((item) => item.id !== id);
  persistBookmarks();
  renderBookmarks();

  if (state.editingId === id) {
    resetDraft(false);
  }

  setFeedback("Bookmark deleted.", "success");
}

function resetDraft(clearFeedback = true) {
  state.draft = null;
  state.editingId = null;
  elements.saveForm.hidden = true;
  elements.definitionOptions.innerHTML = "";
  elements.apiExamplesList.innerHTML = "";
  elements.notesDetails.open = false;
  elements.apiExamplesWrap.open = false;
  elements.apiExamplesWrap.hidden = true;
  elements.phoneticChip.hidden = true;
  elements.customDefinition.value = "";
  elements.customExample.value = "";
  elements.saveButton.textContent = "Save";

  if (clearFeedback) {
    setFeedback("", "");
    setBackupFeedback("", "");
  }
}

function exportBookmarks() {
  if (!state.bookmarks.length) {
    setBackupFeedback("There are no saved words to export yet.", "error");
    return;
  }

  const payload = {
    app: "Word Shelf",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    bookmarks: state.bookmarks,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `word-shelf-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  setBackupFeedback("Export ready.", "success");
}

async function importBookmarks(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const bookmarks = sanitizeBookmarks(payload.bookmarks);

    if (!bookmarks.length) {
      throw new Error("That file does not contain any valid bookmarks.");
    }

    state.bookmarks = mergeBookmarks(state.bookmarks, bookmarks);
    persistBookmarks();
    renderBookmarks();
    setActiveView("bookmarks");
    setBackupFeedback(
      `Imported ${bookmarks.length} word${bookmarks.length === 1 ? "" : "s"}.`,
      "success"
    );
  } catch (error) {
    setBackupFeedback(error.message || "Import failed.", "error");
  } finally {
    event.target.value = "";
  }
}

function mergeBookmarks(existing, incoming) {
  const map = new Map(existing.map((bookmark) => [bookmark.id, bookmark]));
  for (const bookmark of incoming) {
    map.set(bookmark.id, bookmark);
  }
  return Array.from(map.values());
}

function normalizeDictionaryEntry(word, payload) {
  const definitions = [];
  const examples = [];
  let phonetic = "";

  for (const entry of payload) {
    if (!phonetic) {
      phonetic = entry.phonetic || entry.phonetics?.find((item) => item.text)?.text || "";
    }

    for (const meaning of entry.meanings || []) {
      for (const definition of meaning.definitions || []) {
        const text = cleanText(definition.definition);
        if (!text) continue;

        definitions.push({
          id: createId(),
          partOfSpeech: meaning.partOfSpeech || "",
          text,
        });

        const example = cleanText(definition.example);
        if (example && !examples.includes(example)) {
          examples.push(example);
        }
      }
    }
  }

  return {
    word,
    phonetic,
    definitions: dedupeDefinitions(definitions).slice(0, 8),
    examples: examples.slice(0, 3),
  };
}

function dedupeDefinitions(definitions) {
  const seen = new Set();
  return definitions.filter((definition) => {
    const key = `${definition.partOfSpeech}|${definition.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function renderApiExamples(examples) {
  elements.apiExamplesList.innerHTML = "";
  if (!examples.length) {
    elements.apiExamplesWrap.open = false;
    elements.apiExamplesWrap.hidden = true;
    return;
  }

  for (const example of examples) {
    const label = document.createElement("label");
    label.className = "example-option";

    const checkbox = document.createElement("input");
    checkbox.className = "definition-check";
    checkbox.type = "checkbox";
    checkbox.value = example;
    checkbox.checked = Boolean(state.editingId && state.draft.examples.includes(example));

    const text = document.createElement("p");
    text.className = "example-text";
    text.textContent = example;

    label.append(checkbox, text);
    syncDefinitionSelection(label, checkbox);
    checkbox.addEventListener("change", () => syncDefinitionSelection(label, checkbox));
    elements.apiExamplesList.appendChild(label);
  }

  elements.apiExamplesWrap.open = false;
  elements.apiExamplesWrap.hidden = false;
}

function setLookupBusy(isBusy) {
  elements.lookupButton.disabled = isBusy;
  elements.lookupButton.textContent = isBusy ? "Loading..." : "Search";
}

function setFeedback(message, tone) {
  elements.lookupFeedback.textContent = message;
  elements.lookupFeedback.className = "feedback";
  if (tone) {
    elements.lookupFeedback.classList.add(tone);
  }
}

function setBackupFeedback(message, tone) {
  elements.backupFeedback.textContent = message;
  elements.backupFeedback.className = "feedback";
  if (tone) {
    elements.backupFeedback.classList.add(tone);
  }
}

function persistBookmarks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.bookmarks));
}

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return sanitizeBookmarks(JSON.parse(raw));
  } catch {
    return [];
  }
}

function sanitizeBookmarks(bookmarks) {
  if (!Array.isArray(bookmarks)) return [];

  return bookmarks
    .map((bookmark) => ({
      id: String(bookmark.id || createId()),
      word: cleanText(bookmark.word).toLowerCase(),
      phonetic: cleanText(bookmark.phonetic),
      definitions: Array.isArray(bookmark.definitions)
        ? bookmark.definitions
            .map((definition) => ({
              id: String(definition.id || createId()),
              partOfSpeech: cleanText(definition.partOfSpeech),
              text: cleanText(definition.text),
            }))
            .filter((definition) => definition.text)
        : [],
      customDefinition: cleanText(bookmark.customDefinition),
      customExample: cleanText(bookmark.customExample),
      apiExamples: Array.isArray(bookmark.apiExamples)
        ? bookmark.apiExamples.map(cleanText).filter(Boolean).slice(0, 3)
        : [],
      createdAt: bookmark.createdAt || new Date().toISOString(),
      updatedAt: bookmark.updatedAt || bookmark.createdAt || new Date().toISOString(),
    }))
    .filter(
      (bookmark) =>
        bookmark.word &&
        (bookmark.definitions.length ||
          bookmark.customDefinition ||
          bookmark.customExample ||
          bookmark.apiExamples.length)
    );
}

function setActiveView(view) {
  state.activeView = view;

  elements.panels.forEach((panel) => {
    const isActive = panel.dataset.view === view;
    panel.hidden = !isActive;
    panel.classList.toggle("is-active", isActive);
  });

  elements.tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === view);
  });
}

function syncDefinitionSelection(label, checkbox) {
  label.classList.toggle("is-selected", checkbox.checked);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function createId() {
  if (window.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function capitalizeWord(word) {
  return word.replace(/\b\w/g, (match) => match.toUpperCase());
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // Ignore registration failures to keep the app usable without install support.
  }
}
