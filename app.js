const $ = (sel) => document.querySelector(sel);

const listEl = $("#placesList");
const searchEl = $("#search");
const countEl = $("#count");
const btnFit = $("#btnFit");

const DEFAULT_CENTER = [PLACES[0]?.lat ?? -1.4558, PLACES[0]?.lng ?? -48.4902];
const DEFAULT_ZOOM = 13;

let selectedId = "";

const map = L.map("map", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

const markersById = new Map();
const bounds = L.latLngBounds([]);

function formatDate(iso) {
  if (!iso) return "";
  const [y,m,d] = iso.split("-").map(Number);
  const dt = new Date(y, (m-1), d);
  return dt.toLocaleDateString("pt-BR");
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
  const date = p.date ? `<span class="badge">${formatDate(p.date)}</span>` : "";
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
      <h3>${p.title} ${date}</h3>
      <p>${p.text ?? ""}</p>
      ${img}
      ${mp4}
      ${yt}
    </div>
  `;
} 

function addPlaceToList(p){
  const li = document.createElement("li");
  li.className = "placeItem";
  li.dataset.id = p.id;

  if (p.id === selectedId) li.classList.add("active");

  li.innerHTML = `
    <p class="placeTitle">${p.title}</p>
    <div class="placeMeta">
      ${p.tag ? `<span class="badge">${p.tag}</span>` : ""}
      ${p.date ? `<span>${formatDate(p.date)}</span>` : ""}
    </div>
  `;

  li.addEventListener("click", () => selectPlace(p.id, true));
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
  PLACES.forEach(p => {
    addMarker(p);
  });

  renderList(PLACES);

  btnFit.addEventListener("click", () => {
    fitAll();
    const url = new URL(window.location.href);
    url.searchParams.delete("p");
    window.history.replaceState({}, "", url.toString());
    highlightListItem("");
  });

  searchEl.addEventListener("input", applyFilter);

  const url = new URL(window.location.href);
  const pid = url.searchParams.get("p");
  if (pid && markersById.has(pid)) {
    focusPlace(pid, true);
  } else {
    fitAll();
  }
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
  // pausa extra (além da velocidade base) depois de certos caracteres
  if (char === "," ) return 140;
  if (char === ";" ) return 170;
  if (char === ":" ) return 180;

  // reticências "..." ou "…"
  if (char === "." && nextChar === ".") return 110; // cada ponto da reticência dá uma paradinha
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

    const baseMs = Math.max(
      10,
      Math.floor((durationMs - pauseTotal) / full.length)
    );

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
  (async () => {
    await typeWriter(landingTitleEl, 900);  
    await wait(120);
    await typeWriter(landingTextEl, 3300);  
  })();

  closeTimeout = setTimeout(closeLanding, 8000); 
}

boot();