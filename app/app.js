/* Liberty Cut — studio UI logic.
 *
 * Talks to ComfyUI exclusively through the /comfy proxy exposed by
 * app/server.py (same origin, no CORS). Workflows are the API-format
 * JSON files in ../workflows/; this file patches their inputs by node id:
 *
 *   cast_card_flux.json            node 4 = portrait prompt, node 8 = seed
 *   keyframe_flux_pulid.json       node 7 = cast ref image, node 9 = scene prompt, node 13 = seed
 *   relight_flux_pulid_img2img.json node 7 = cast ref, node 9 = scene+hour prompt,
 *                                   node 16 = source keyframe, node 13 = seed
 *   shot_ltx_i2v.json              node 3 = motion prompt, node 5 = keyframe image,
 *                                   node 6 = length, node 10 = noise seed
 */
"use strict";

/* ---------------- presets ---------------- */

const CAMERA_MOVES = {
  still:     { label: "Locked off (still)", phrase: "the camera remains completely still" },
  push_in:   { label: "Slow push-in",       phrase: "the camera slowly pushes in toward the subject" },
  pull_back: { label: "Slow pull-back",     phrase: "the camera slowly pulls back, revealing more of the scene" },
  pan_left:  { label: "Pan left",           phrase: "the camera pans slowly to the left" },
  pan_right: { label: "Pan right",          phrase: "the camera pans slowly to the right" },
  orbit:     { label: "Slow orbit",         phrase: "the camera slowly orbits around the subject" },
};

const HOURS = {
  dawn: "at dawn — cool blue-grey early light, long soft shadows, faint mist, the world just waking",
  noon: "at midday — bright direct sunlight, hard shadows, vivid saturated colour, clear sky",
  dusk: "at dusk — warm golden-hour light low on the horizon, amber sky, lights beginning to glow",
};

const NEGATIVE_VIDEO =
  "low quality, distorted face, changing face, morphing features, extra fingers, watermark, text, jump cut, flicker";

/* ---------------- state ---------------- */

const state = {
  cast: [],          // {name, desc, cardFile:{filename,subfolder,type}, inputName}
  selectedCast: -1,  // index into state.cast
  shots: [],         // rendered: {castName, prompt, camera, frames, keyframeFile, videoFile}
  relightHour: "dawn",
  templates: {},     // workflow name -> parsed JSON
};

/* ---------------- small helpers ---------------- */

const $ = (sel) => document.querySelector(sel);

function seedFromString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h % 1000000000);
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "cast";
}

function logger(el) {
  el.hidden = false;
  el.textContent = "";
  return (msg) => {
    el.textContent += msg + "\n";
    el.scrollTop = el.scrollHeight;
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ---------------- ComfyUI API ---------------- */

async function loadTemplate(name) {
  if (!state.templates[name]) {
    const res = await fetch("/workflows/" + name);
    if (!res.ok) throw new Error("could not load workflow template " + name);
    state.templates[name] = await res.json();
  }
  return clone(state.templates[name]);
}

async function queuePrompt(workflow) {
  const res = await fetch("/comfy/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error("ComfyUI rejected the prompt: " + JSON.stringify(data.error || data));
  }
  return data.prompt_id;
}

async function waitForCompletion(promptId, log, label) {
  for (let i = 0; i < 3600; i++) {
    const res = await fetch("/comfy/history/" + promptId);
    const hist = await res.json();
    const entry = hist[promptId];
    if (entry && entry.status) {
      if (entry.status.status_str === "error") {
        throw new Error(label + " failed in ComfyUI: " +
          JSON.stringify(entry.status.messages || entry.status));
      }
      if (entry.status.completed) return entry;
    }
    if (i % 6 === 0) log("  … " + label + " running (" + i * 2 + "s)");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(label + " timed out after 2 hours");
}

/* Gather every file a finished prompt produced, whatever key ComfyUI
 * filed it under (images / videos / gifs), classified by extension. */
function collectOutputs(entry) {
  const images = [], videos = [];
  for (const nodeOut of Object.values(entry.outputs || {})) {
    for (const value of Object.values(nodeOut)) {
      if (!Array.isArray(value)) continue;
      for (const f of value) {
        if (!f || typeof f.filename !== "string") continue;
        const file = { filename: f.filename, subfolder: f.subfolder || "", type: f.type || "output" };
        if (/\.(mp4|webm|mov)$/i.test(f.filename)) videos.push(file);
        else if (/\.(png|jpe?g|webp)$/i.test(f.filename)) images.push(file);
      }
    }
  }
  return { images, videos };
}

function viewUrl(file) {
  const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type });
  return "/comfy/view?" + q.toString();
}

/* Upload an image (blob) into ComfyUI's input folder; returns the name
 * a LoadImage node should use. */
async function uploadAsInput(blob, name) {
  const form = new FormData();
  form.append("image", blob, name);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await fetch("/comfy/upload/image", { method: "POST", body: form });
  if (!res.ok) throw new Error("image upload to ComfyUI failed (HTTP " + res.status + ")");
  const data = await res.json();
  return data.subfolder ? data.subfolder + "/" + data.name : data.name;
}

async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed: " + url);
  return res.blob();
}

/* Run one workflow end-to-end; returns {images, videos} file refs. */
async function runWorkflow(templateName, patch, log, label) {
  const wf = await loadTemplate(templateName);
  patch(wf);
  log("Queueing " + label + "…");
  const id = await queuePrompt(wf);
  const entry = await waitForCompletion(id, log, label);
  const out = collectOutputs(entry);
  log("Done: " + label);
  return out;
}

/* ---------------- health ---------------- */

async function checkHealth() {
  const el = $("#comfy-status");
  try {
    const res = await fetch("/api/health");
    const h = await res.json();
    if (h.comfy === "ok") {
      el.textContent = "ComfyUI connected" + (h.device ? " · " + h.device : "") +
        (h.ffmpeg ? "" : " · ffmpeg missing (assembly off)");
      el.className = "status status-ok";
    } else {
      el.textContent = "ComfyUI not reachable — start it on port 8188, then reload";
      el.className = "status status-bad";
    }
  } catch (e) {
    el.textContent = "App server health check failed";
    el.className = "status status-bad";
  }
}

/* ---------------- cast ---------------- */

function refreshCastSelects() {
  document.querySelectorAll(".cast-select").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = "";
    state.cast.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    if (current && state.cast[Number(current)]) sel.value = current;
  });
}

function selectCastCard(index) {
  state.selectedCast = index;
  document.querySelectorAll(".cast-card").forEach((card, i) => {
    card.classList.toggle("selected", i === index);
  });
}

async function generateCastCard() {
  const name = $("#cast-name").value.trim();
  const desc = $("#cast-desc").value.trim();
  if (!name || !desc) { alert("Give the character a name and a description first."); return; }
  const btn = $("#btn-cast");
  btn.disabled = true;
  try {
    const prompt =
      "cinematic portrait photograph of an original fictional character, " + desc +
      ", neutral grey studio background, soft key light, sharp focus on the face, 85mm lens, shallow depth of field";
    const out = await runWorkflow("cast_card_flux.json", (wf) => {
      wf["4"].inputs.text = prompt;
      wf["8"].inputs.seed = seedFromString("cast:" + name + ":" + desc);
      wf["10"].inputs.filename_prefix = "libertycut/cast_" + slug(name);
    }, () => {}, "cast card for " + name);
    if (!out.images.length) throw new Error("cast render produced no image");
    const cardFile = out.images[0];

    // Re-upload the card as a ComfyUI input so PuLID can read it as a reference.
    const blob = await fetchBlob(viewUrl(cardFile));
    const inputName = await uploadAsInput(blob, "cast_" + slug(name) + ".png");

    const member = { name, desc, cardFile, inputName };
    state.cast.push(member);
    const index = state.cast.length - 1;

    const card = document.createElement("div");
    card.className = "cast-card";
    const img = document.createElement("img");
    img.src = viewUrl(cardFile);
    img.alt = "Cast card — " + name;
    const label = document.createElement("div");
    label.className = "cast-name";
    label.textContent = name;
    card.append(img, label);
    card.addEventListener("click", () => selectCastCard(index));
    $("#cast-grid").appendChild(card);

    selectCastCard(index);
    refreshCastSelects();
    addToGallery(cardFile, "Cast card — " + name, "image");
    $("#cast-name").value = "";
    $("#cast-desc").value = "";
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- shot list ---------------- */

function addShotRow(prefill) {
  const rows = $("#shot-rows");
  const n = rows.children.length + 1;
  const row = document.createElement("div");
  row.className = "shot-row";

  const head = document.createElement("div");
  head.className = "shot-head";
  const title = document.createElement("strong");
  title.textContent = "Shot " + n;
  const spacer = document.createElement("span");
  spacer.className = "spacer";
  const castSel = document.createElement("select");
  castSel.className = "cast-select";
  const camSel = document.createElement("select");
  camSel.className = "camera-select";
  for (const [key, c] of Object.entries(CAMERA_MOVES)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = c.label;
    camSel.appendChild(opt);
  }
  const lenSel = document.createElement("select");
  lenSel.className = "length-select";
  for (const [frames, label] of [[49, "≈2 s"], [97, "≈4 s"], [193, "≈8 s"]]) {
    const opt = document.createElement("option");
    opt.value = String(frames);
    opt.textContent = label;
    lenSel.appendChild(opt);
  }
  lenSel.value = "97";
  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => { row.remove(); renumberShots(); });
  head.append(title, spacer, castSel, camSel, lenSel, remove);

  const prompt = document.createElement("textarea");
  prompt.className = "shot-prompt";
  prompt.placeholder = "Describe the shot — setting, action, mood, palette…";
  if (prefill) {
    prompt.value = prefill.prompt || "";
    camSel.value = prefill.camera || "push_in";
  }
  row.append(head, prompt);
  rows.appendChild(row);
  refreshCastSelects();
  return row;
}

function renumberShots() {
  document.querySelectorAll("#shot-rows .shot-row").forEach((row, i) => {
    row.querySelector(".shot-head strong").textContent = "Shot " + (i + 1);
  });
}

function readShotRows() {
  return [...document.querySelectorAll("#shot-rows .shot-row")].map((row) => ({
    castIndex: Number(row.querySelector(".cast-select").value || 0),
    camera: row.querySelector(".camera-select").value,
    frames: Number(row.querySelector(".length-select").value || 97),
    prompt: row.querySelector(".shot-prompt").value.trim(),
  }));
}

/* Animate a keyframe file (already a ComfyUI output) with LTX. */
async function animateKeyframe(keyframeFile, motionText, cameraKey, frames, seed, prefix, log) {
  const blob = await fetchBlob(viewUrl(keyframeFile));
  const inputName = await uploadAsInput(blob, prefix + ".png");
  const out = await runWorkflow("shot_ltx_i2v.json", (wf) => {
    wf["3"].inputs.text =
      motionText + ", " + CAMERA_MOVES[cameraKey].phrase +
      ", cinematic motion, the character's face and outfit stay exactly the same, no cuts";
    wf["4"].inputs.text = NEGATIVE_VIDEO;
    wf["5"].inputs.image = inputName;
    wf["6"].inputs.length = frames;
    wf["10"].inputs.noise_seed = seed;
    wf["13"].inputs.filename_prefix = "libertycut/" + prefix;
  }, log, "LTX animation (" + prefix + ")");
  if (!out.videos.length) throw new Error("LTX produced no video for " + prefix);
  return out.videos[0];
}

async function renderScene() {
  const shots = readShotRows().filter((s) => s.prompt);
  if (!state.cast.length) { alert("Create at least one cast card first."); return; }
  if (shots.length < 3) { alert("Ensemble Continuity wants a shot list of three or more shots."); return; }
  const btn = $("#btn-render-scene");
  btn.disabled = true;
  const log = logger($("#scene-log"));
  state.shots = [];
  try {
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const member = state.cast[shot.castIndex] || state.cast[0];
      log("Shot " + (i + 1) + "/" + shots.length + " — " + member.name +
          " · " + CAMERA_MOVES[shot.camera].label);
      const seed = seedFromString("shot:" + i + ":" + member.name + ":" + shot.prompt);

      const kf = await runWorkflow("keyframe_flux_pulid.json", (wf) => {
        wf["7"].inputs.image = member.inputName;
        wf["9"].inputs.text = "cinematic film still, " + shot.prompt;
        wf["13"].inputs.seed = seed;
        wf["15"].inputs.filename_prefix = "libertycut/keyframe_" + (i + 1);
      }, log, "keyframe " + (i + 1));
      if (!kf.images.length) throw new Error("keyframe " + (i + 1) + " produced no image");
      const keyframeFile = kf.images[0];
      addToGallery(keyframeFile, "Shot " + (i + 1) + " keyframe — " + member.name, "image");

      const videoFile = await animateKeyframe(
        keyframeFile, shot.prompt, shot.camera, shot.frames, seed,
        "shot_" + (i + 1), log);
      addToGallery(videoFile, "Shot " + (i + 1) + " — " + member.name, "video");
      state.shots.push({ ...shot, castName: member.name, castIndex: shot.castIndex,
                         keyframeFile, videoFile });
    }

    // Assemble the scene.
    log("Assembling scene with ffmpeg…");
    const res = await fetch("/assemble", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: state.shots.map((s) => s.videoFile) }),
    });
    const data = await res.json();
    const result = $("#scene-result");
    result.innerHTML = "";
    if (res.ok) {
      const video = document.createElement("video");
      video.controls = true;
      video.src = "/" + data.file;
      result.appendChild(video);
      log("Scene assembled: " + data.file);
    } else {
      log("Assembly unavailable: " + (data.error || res.status) +
          " — the individual shots are in the gallery.");
    }
    refreshRelightSelect();
  } catch (e) {
    log("ERROR: " + e.message);
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------- relight & hour ---------------- */

function refreshRelightSelect() {
  const sel = $("#relight-shot-select");
  sel.innerHTML = "";
  state.shots.forEach((s, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = "Shot " + (i + 1) + " — " + s.castName;
    sel.appendChild(opt);
  });
  $("#btn-relight").disabled = state.shots.length === 0;
}

async function relightSelected() {
  const idx = Number($("#relight-shot-select").value || 0);
  const shot = state.shots[idx];
  if (!shot) { alert("Render a scene first."); return; }
  const member = state.cast[shot.castIndex] || state.cast[0];
  const hour = state.relightHour;
  const btn = $("#btn-relight");
  btn.disabled = true;
  const log = logger($("#relight-log"));
  try {
    log("Relighting shot " + (idx + 1) + " → " + hour + " (identity re-locked to " + member.name + ")");
    const seed = seedFromString("relight:" + idx + ":" + hour + ":" + shot.prompt);
    const srcBlob = await fetchBlob(viewUrl(shot.keyframeFile));
    const srcName = await uploadAsInput(srcBlob, "relight_src_" + (idx + 1) + ".png");

    const out = await runWorkflow("relight_flux_pulid_img2img.json", (wf) => {
      wf["7"].inputs.image = member.inputName;
      wf["9"].inputs.text =
        "cinematic film still, " + shot.prompt + ", " + HOURS[hour] +
        ", same character, same outfit, same position and framing as the source image";
      wf["13"].inputs.seed = seed;
      wf["15"].inputs.filename_prefix = "libertycut/relight_" + (idx + 1) + "_" + hour;
      wf["16"].inputs.image = srcName;
    }, log, "relight " + hour);
    if (!out.images.length) throw new Error("relight produced no image");
    const relitFile = out.images[0];

    const holder = document.createElement("figure");
    holder.className = "gallery-item";
    const img = document.createElement("img");
    img.src = viewUrl(relitFile);
    img.alt = "Shot " + (idx + 1) + " at " + hour;
    const cap = document.createElement("figcaption");
    cap.textContent = "Shot " + (idx + 1) + " — " + hour;
    holder.append(img, cap);
    $("#relight-results").appendChild(holder);
    addToGallery(relitFile, "Shot " + (idx + 1) + " relit — " + hour, "image");

    const videoFile = await animateKeyframe(
      relitFile, shot.prompt + ", " + HOURS[hour], shot.camera, shot.frames, seed,
      "relight_" + (idx + 1) + "_" + hour, log);
    addToGallery(videoFile, "Shot " + (idx + 1) + " at " + hour + " (video)", "video");
    log("Relight complete.");
  } catch (e) {
    log("ERROR: " + e.message);
    alert(e.message);
  } finally {
    btn.disabled = state.shots.length === 0;
  }
}

/* ---------------- gallery ---------------- */

function addToGallery(file, caption, kind) {
  const fig = document.createElement("figure");
  fig.className = "gallery-item";
  let media;
  if (kind === "video") {
    media = document.createElement("video");
    media.controls = true;
    media.src = viewUrl(file);
  } else {
    media = document.createElement("img");
    media.src = viewUrl(file);
    media.alt = caption;
  }
  const cap = document.createElement("figcaption");
  cap.textContent = caption;
  fig.append(media, cap);
  $("#gallery").prepend(fig);
}

/* ---------------- wire up ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  checkHealth();
  $("#btn-cast").addEventListener("click", generateCastCard);
  $("#btn-add-shot").addEventListener("click", () => addShotRow());
  $("#btn-render-scene").addEventListener("click", renderScene);
  $("#btn-relight").addEventListener("click", relightSelected);
  document.querySelectorAll(".hour-btn").forEach((b) => {
    b.addEventListener("click", () => {
      state.relightHour = b.dataset.hour;
      document.querySelectorAll(".hour-btn").forEach((x) =>
        x.classList.toggle("selected", x === b));
    });
    if (b.dataset.hour === state.relightHour) b.classList.add("selected");
  });

  // Starter shot list — the demo scene from examples/ ("The Night Market").
  addShotRow({ camera: "push_in",
    prompt: "a night-market food stall strung with warm bulbs, steam rising from a grill; the character turns and smiles at a friend off camera, teal and amber palette, anamorphic look" });
  addShotRow({ camera: "pan_right",
    prompt: "the same night market, the character walks between stalls carrying a paper tray of food, vendors and lanterns passing behind her, warm practical lights" });
  addShotRow({ camera: "orbit",
    prompt: "close on the character laughing at a shared table in the night market, string lights bokeh behind her, friends' hands passing dishes across the frame" });
});
