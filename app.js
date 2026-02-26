const $ = (sel) => document.querySelector(sel);

const listEl = $("#placesList");
const searchEl = $("#search");
const countEl = $("#count");
const btnFit = $("#btnFit");
const btnBack = $("#btnBack");

const mqMobile = window.matchMedia("(max-width: 768px)");
const isMobile = () => mqMobile.matches;

const DEFAULT_CENTER = [PLACES[0]?.lat ?? -1.4558, PLACES[0]?.lng ?? -48.4902];
const DEFAULT_ZOOM = 13;

let selectedId = "";

const map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

function setMobileView(view){
  if (!isMobile()){
    document.body.classList.remove("mobileList", "mobileMap");
    if (btnBack) btnBack.hidden = true;
    return;
  }

  document.body.classList.toggle("mobileList", view === "list");
  document.body.classList.toggle("mobileMap", view === "map");

  if (btnBack) btnBack.hidden = view !== "map";

  if (view === "map"){
    setTimeout(() => map.invalidateSize(), 140);
  }
}

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

const markersById = new Map();
const bounds = L.latLngBounds([]);

function formatDate(iso) {
  if (!iso) return "";
  const [y,m,d] = iso.split("-").map(Number);
  const dt = new Date(y, (m-1), d);
  return dt.toLocaleDateString("pt-BR");
}

function uniq(arr){
  return [...new Set(arr.filter(Boolean))];
}

async function withLimit(items, limit, worker){
  const queue = items.slice();
  const runners = Array.from({ length: Math.max(1, limit) }, async () => {
    while (queue.length){
      const item = queue.shift();
      try { await worker(item); } catch {}
    }
  });
  await Promise.all(runners);
}

function preloadImage(url){
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.loading = "eager";
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
    if (img.decode) img.decode().then(() => resolve(true)).catch(() => resolve(false));
  });
}

function warmVideo(url){
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.onloadedmetadata = () => resolve(true);
    v.onerror = () => resolve(false);
    v.src = url;
    v.load();
  });
}

function addPreloadLink(as, href, type){
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = as;
  link.href = href;
  if (type) link.type = type;
  document.head.appendChild(link);
}

function startPreloadMedia(){
  const imgs = uniq(PLACES.map(p => p.photo));
  const vids = uniq(PLACES.map(p => p.videoMp4));

  imgs.slice(0, 6).forEach(u => addPreloadLink("image", u));
  vids.slice(0, 2).forEach(u => addPreloadLink("video", u, "video/mp4"));

  const p1 = withLimit(imgs, 4, preloadImage);
  const p2 = withLimit(vids, 2, warmVideo);

  return Promise.allSettled([p1, p2]);
}

function toYouTubeEmbed(url) {
  try {
    const u = new URL(url);
    const id =
      u.searchParams.get("v") ||
      (u.hostname.includes("youtu.be") ? u.pathname.replace("/", "") : "");
    return id ? `https://www.youtube.com/embed/${id}` : "";
  } catch {
    return "";
  }
}

function popupHTML(p){
  const date = p.date ? `<span class="badge popupDate">${formatDate(p.date)}</span>` : "";
  const img = p.photo ? `<img src="${p.photo}" alt="${p.title}">` : "";
  const link = p.link ? `<a href="${p.link}" target="_blank" rel="noreferrer">Abrir link</a>` : "";

  const mp4 = p.videoMp4
    ? `<video class="popupMedia" controls preload="metadata">
         <source src="${p.videoMp4}" type="video/mp4">
         Seu navegador não suporta vídeo.
       </video>`
    : "";

  const ytEmbed = p.youtube ? toYouTubeEmbed(p.youtube) : "";
  const yt = ytEmbed
    ? `<div class="ytWrap">
         <iframe
           src="${ytEmbed}"
           title="YouTube video"
           frameborder="0"
           allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
           allowfullscreen
         ></iframe>
       </div>`
    : "";

  return `
    <div class="popup">
      <div class="popupTop">
        <h3 class="popupTitle">${p.title}</h3>
        ${date || ""}
      </div>
      <p>${p.text ?? ""}</p>
      ${img}
      ${mp4}
      ${yt}
      ${link}
    </div>
  `;
}

function addPlaceToList(p){
  const li = document.createElement("li");
  li.className = "placeItem";
  li.dataset.id = p.id;

  if (p.id === selectedId) li.classList.add("active");

  const dateText = p.date ? formatDate(p.date) : "";

  li.innerHTML = `
    <div class="placeTop">
      <p class="placeTitle">${p.title}</p>
    </div>
    <div class="placeMeta">
      <div class="placeTags">
        ${p.tag ? `<span class="badge">${p.tag}</span>` : ``}
      </div>
      <span class="placeDateRight">${dateText}</span>
    </div>
  `;

  li.addEventListener("click", () => {
    if (isMobile()){
      setMobileView("map");
      setTimeout(() => selectPlace(p.id, true), 170);
      return;
    }
    selectPlace(p.id, true);
  });

  listEl.appendChild(li);
}

function addMarker(p){
  const latlng = L.latLng(p.lat, p.lng);
  bounds.extend(latlng);

  const marker = L.marker(latlng).addTo(map);
  marker.bindPopup(popupHTML(p), { maxWidth: 260 });

  marker.on("click", () => {
    highlightListItem(p.id);
    updateUrl(p.id);
  });

  markersById.set(p.id, marker);
}

function highlightListItem(id){
  selectedId = id || "";
  document.querySelectorAll(".placeItem").forEach(el => {
    el.classList.toggle("active", el.dataset.id === selectedId);
  });
}

function selectPlace(id, openPopup = true) {
  const marker = markersById.get(id);
  if (!marker) return;

  const ll = marker.getLatLng();

  map.flyTo(ll, Math.max(map.getZoom(), 16), {
    animate: true,
    duration: 0.9
  });

  if (openPopup) marker.openPopup();

  highlightListItem(id);
  updateUrl(id);
}

function updateUrl(id){
  const url = new URL(window.location.href);
  url.searchParams.set("p", id);
  window.history.replaceState({}, "", url.toString());
}

function fitAll(){
  if (!bounds.isValid()) return;
  map.fitBounds(bounds.pad(0.2));
}

function renderList(filtered){
  listEl.innerHTML = "";
  filtered.forEach(addPlaceToList);
  countEl.textContent = String(filtered.length);
  highlightListItem(selectedId);
}

function applyFilter(){
  const q = (searchEl.value || "").trim().toLowerCase();
  const filtered = PLACES.filter(p =>
    (p.title || "").toLowerCase().includes(q) ||
    (p.text || "").toLowerCase().includes(q) ||
    (p.tag || "").toLowerCase().includes(q)
  );
  renderList(filtered);
}

function boot(){
  PLACES.forEach(addMarker);
  renderList(PLACES);

  if (btnFit){
    btnFit.addEventListener("click", () => {
      fitAll();
      const url = new URL(window.location.href);
      url.searchParams.delete("p");
      window.history.replaceState({}, "", url.toString());
      highlightListItem("");
    });
  }

  searchEl.addEventListener("input", applyFilter);

  if (btnBack){
    btnBack.addEventListener("click", () => {
      map.closePopup();
      setMobileView("list");
      const u = new URL(window.location.href);
      u.searchParams.delete("p");
      window.history.replaceState({}, "", u.toString());
    });
  }

  const url = new URL(window.location.href);
  const pid = url.searchParams.get("p");

  if (pid && markersById.has(pid)) {
    if (isMobile()){
      setMobileView("map");
      setTimeout(() => selectPlace(pid, true), 170);
    } else {
      selectPlace(pid, true);
    }
  } else {
    if (isMobile()){
      setMobileView("list");
    } else {
      fitAll();
    }
  }

  mqMobile.addEventListener("change", () => {
    const u = new URL(window.location.href);
    const pid2 = u.searchParams.get("p");

    if (!isMobile()){
      setMobileView("map");
      setTimeout(() => map.invalidateSize(), 80);
      return;
    }

    if (pid2 && markersById.has(pid2)){
      setMobileView("map");
      setTimeout(() => selectPlace(pid2, true), 170);
    } else {
      setMobileView("list");
    }
  });
}

const landingEl = document.getElementById("landing");
const landingTitleEl = document.getElementById("landingTitle");
const landingTextEl = document.getElementById("landingText");

let typingInterval = null;
let closeTimeout = null;

function closeLanding() {
  if (!landingEl) return;

  if (typingInterval) clearTimeout(typingInterval);
  if (closeTimeout) clearTimeout(closeTimeout);

  landingEl.classList.add("isHidden");

  setTimeout(() => {
    if (landingEl.parentNode) landingEl.remove();
    setTimeout(() => map.invalidateSize(), 80);
  }, 700);
}

function getPauseMs(char, nextChar) {
  if (char === ",") return 140;
  if (char === ";") return 170;
  if (char === ":") return 180;
  if (char === "." && nextChar === ".") return 110;
  if (char === "…") return 320;
  if (char === "." || char === "!" || char === "?") return 320;
  if (char === "\n") return 260;
  return 0;
}

function typeWriter(el, durationMs) {
  return new Promise((resolve) => {
    if (!el) return resolve();

    const full = el.dataset.text || "";
    el.textContent = "";
    el.classList.add("typing");

    if (!full.length) {
      el.classList.remove("typing");
      return resolve();
    }

    let pauseTotal = 0;
    for (let i = 0; i < full.length; i++) {
      pauseTotal += getPauseMs(full[i], full[i + 1]);
    }

    const baseMs = Math.max(10, Math.floor((durationMs - pauseTotal) / full.length));
    let i = 0;

    const tick = () => {
      el.textContent += full[i];

      const current = full[i];
      const next = full[i + 1];

      i++;
      if (i >= full.length) {
        el.classList.remove("typing");
        return resolve();
      }

      const delay = baseMs + getPauseMs(current, next);
      typingInterval = setTimeout(tick, delay);
    };

    tick();
  });
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

if (landingEl) {
  startPreloadMedia();

  (async () => {
    await typeWriter(landingTitleEl, 900);
    await wait(120);
    await typeWriter(landingTextEl, 3300);
  })();

  closeTimeout = setTimeout(closeLanding, 8000);
}

boot();