/* Briefing Espaces Verts — Club Med Cap Skirring */
"use strict";
const K = "bev_";
const ls = {
  get(k, d) { try { const v = localStorage.getItem(K + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(K + k, JSON.stringify(v)); } catch (e) {} }
};
const S = {
  codes: ls.get("codes", []), role: ls.get("role", null), secteurs: ls.get("secteurs", []),
  taches: ls.get("taches", {}), outbox: ls.get("outbox", []), synchro: ls.get("synchro", null),
  moi: ls.get("moi", {}), brief: ls.get("brief", {})
};
const save = (...k) => k.forEach(x => ls.set(x, S[x]));
const U = { view: null, date: iso(new Date()), equipe: "jardin", sect: null, add: null, addAct: null, ko: null, err: "", busy: false, codeErr: "", installEvt: null };
const main = document.getElementById("main");

/* ---------- outils ---------- */
function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function shift(s, n) { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); }
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function longDate(s) { const d = new Date(s + "T12:00:00"); return JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()]; }
function rel(s) { const t = iso(new Date()); return s === t ? "Aujourd’hui" : s === shift(t, 1) ? "Demain" : s === shift(t, -1) ? "Hier" : longDate(s); }
function heure(x) { if (!x) return ""; const d = new Date(x); return isNaN(d) ? "" : String(d.getHours()).padStart(2, "0") + " h " + String(d.getMinutes()).padStart(2, "0"); }
function quand(x) { if (!x) return ""; const d = new Date(x); if (isNaN(d)) return ""; const j = iso(d), t = iso(new Date()); return (j === t ? "aujourd’hui" : j === shift(t, -1) ? "hier" : "le " + longDate(j)) + " à " + heure(x); }
const h = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function affNom(n) {
  const p = String(n || "").trim().split(/\s+/); let i = 0;
  while (i < p.length && /^[A-ZÀ-Ý'’-]{2,}$/.test(p[i])) i++;
  if (i === 0 || i === p.length) return String(n || "");
  return p.slice(i).join(" ") + " " + p.slice(0, i).join(" ");
}
function liste(a) { return a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " et " + a[a.length - 1]; }
const prio = t => t.priorite === true || t.priorite === "oui";
const fait = t => t.statut === "fait";
const pasFait = t => t.statut === "pas fait";
const enAttente = id => S.outbox.some(o => o.tache.id === id);
const secteur = id => S.secteurs.find(s => s.id === id);
const actsFor = s => (LIBS.ACTS[s.id] || LIBS.ACTS[s.equipe] || []);
function verbe(s, act) {
  const f = actsFor(s).find(x => x[0] === act) || (LIBS.ACTS[s.equipe] || []).find(x => x[0] === act);
  return f ? f[1] : act.charAt(0).toLowerCase() + act.slice(1);
}
function phraseTache(s, t) {
  const titre = String(t.activite || "").trim();
  const desc = String(t.precision || "").trim();
  let v = desc ? titre.charAt(0).toLowerCase() + titre.slice(1) + " (" + desc.replace(/[.\s]+$/, "") + ")" : verbe(s, titre).replace(/\s*(sur|de|des|d'|d’|:|,)\s*$/i, "");
  if (t.pour) v += " (" + affNom(t.pour) + ")";
  return v;
}
function tachesDe(sid, date) {
  return Object.values(S.taches).filter(t => t.secteur === sid && t.date === date)
    .sort((a, b) => (prio(b) - prio(a)) || String(a.id).localeCompare(String(b.id)));
}

/* ---------- synchronisation ---------- */
let syncing = false, syncTimer = null;
function queue(type, tache) {
  S.outbox.push({ op: uid(), type, tache: Object.assign({}, tache) });
  if (type === "supprimer") delete S.taches[tache.id]; else S.taches[tache.id] = tache;
  save("outbox", "taches"); render();
  clearTimeout(syncTimer); syncTimer = setTimeout(sync, 800);
}
async function api(body) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(API_URL, { method: "POST", body: JSON.stringify(body), signal: ctl.signal });
    return await r.json();
  } finally { clearTimeout(tm); }
}
async function sync() {
  if (!S.codes.length || syncing || !/^https:\/\//.test(API_URL)) return;
  if (!navigator.onLine) { status(); return; }
  syncing = true; status();
  try {
    const ops = S.outbox.slice(0, 150);
    const r = await api({ action: "synchro", codes: S.codes, ops });
    if (!r.ok) throw new Error(r.erreur === "Code inconnu" ? "Ton code n’est plus valable. Demande le nouveau code à ton responsable, puis entre-le dans Réglages." : r.erreur);
    const recus = new Set(r.recus || []);
    S.outbox = S.outbox.filter(o => !recus.has(o.op));
    const n = {};
    (r.taches || []).forEach(t => { n[t.id] = t; });
    S.outbox.forEach(o => { if (o.type === "supprimer") delete n[o.tache.id]; else if (S.taches[o.tache.id]) n[o.tache.id] = S.taches[o.tache.id]; });
    S.taches = n; S.secteurs = r.secteurs || S.secteurs; S.role = r.role || S.role; S.synchro = r.heure;
    U.err = "";
    save("outbox", "taches", "secteurs", "role", "synchro");
    if (S.outbox.length && recus.size) { syncing = false; return sync(); }
  } catch (e) {
    U.err = e.name === "AbortError" ? "Réseau trop lent : les validations restent dans le téléphone et partiront plus tard." :
      (e instanceof TypeError ? "Pas de réseau pour le moment : les validations partiront plus tard." : e.message);
  }
  syncing = false;
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && main.contains(a)) status(); else render();
}
function status() {
  const b = document.getElementById("net"), t = document.getElementById("netTxt");
  if (!S.codes.length) { b.hidden = true; return; }
  b.hidden = false; b.className = "net";
  const n = S.outbox.length;
  if (syncing) { t.textContent = "Envoi…"; b.classList.add("wait"); }
  else if (!navigator.onLine) { t.textContent = n ? n + " en attente · hors ligne" : "Hors ligne"; b.classList.add("off"); }
  else if (n) { t.textContent = n + " en attente"; b.classList.add("wait"); }
  else if (U.err) { t.textContent = "À réessayer"; b.classList.add("wait"); }
  else { t.textContent = S.synchro ? "À jour " + heure(S.synchro) : "À jour"; }
}
window.addEventListener("online", () => { status(); sync(); });
window.addEventListener("offline", status);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync(); });
setInterval(() => { if (document.visibilityState === "visible") sync(); }, 90000);

/* ---------- connexion ---------- */
async function connexion(code) {
  code = String(code || "").trim();
  if (!code) return;
  if (!/^https:\/\//.test(API_URL)) { U.codeErr = "L’application n’est pas encore reliée au Google Sheet : colle l’adresse de l’Apps Script dans le fichier config.js."; return render(); }
  if (!navigator.onLine) { U.codeErr = "La première connexion demande Internet. Ensuite, l’application marche sans réseau."; return render(); }
  U.busy = true; U.codeErr = ""; render();
  try {
    const r = await api({ action: "connexion", code });
    if (!r.ok) throw new Error(r.erreur === "Code inconnu" ? "Ce code n’existe pas. Vérifie-le avec ton responsable." : r.erreur);
    if (!S.codes.map(c => c.toUpperCase()).includes(code.toUpperCase())) S.codes.push(code);
    const nouveaux = r.secteurs.filter(x => !S.secteurs.some(y => y.id === x.id));
    S.role = r.role === "admin" || S.role === "admin" ? "admin" : "secteur";
    S.secteurs = S.role === "admin" && r.role === "admin" ? r.secteurs : S.secteurs.concat(nouveaux);
    save("codes", "role", "secteurs");
    U.view = S.role === "admin" ? "programme" : "taches";
    if (nouveaux.length && S.role !== "admin") U.sect = nouveaux[0].id;
    U.busy = false; render(); sync();
  } catch (e) {
    U.busy = false;
    U.codeErr = e.name === "AbortError" ? "Le réseau est trop lent. Réessaie." : e instanceof TypeError ? "Connexion impossible. Vérifie le réseau et réessaie." : e.message;
    render();
  }
}
function deconnexion() {
  const msg = S.outbox.length ? S.outbox.length + " validation(s) ne sont pas encore envoyées et seront perdues. Te déconnecter quand même ?" : "Te déconnecter de ce téléphone ?";
  if (!confirm(msg)) return;
  ["codes", "role", "secteurs", "taches", "outbox", "synchro"].forEach(k => { try { localStorage.removeItem(K + k); } catch (e) {} });
  S.codes = []; S.role = null; S.secteurs = []; S.taches = {}; S.outbox = []; S.synchro = null;
  U.view = null; U.sect = null; render();
}

/* ---------- affichage ---------- */
const ICONS = {
  taches: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9"/>',
  programme: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 15h3"/>',
  suivi: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  briefing: '<path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3z"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
  reglages: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'
};
function nav() {
  const n = document.getElementById("nav"), i = document.getElementById("navIn");
  if (!S.codes.length) { n.hidden = true; return; }
  n.hidden = false;
  const items = S.role === "admin"
    ? [["programme", "Programme"], ["suivi", "Suivi"], ["briefing", "Briefing"], ["reglages", "Réglages"]]
    : [["taches", "Mes tâches"], ["reglages", "Réglages"]];
  i.innerHTML = items.map(([v, l]) => `<button data-act="view" data-v="${v}" ${U.view === v ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[v]}</svg>${l}</button>`).join("");
}
function render() {
  if (!S.codes.length) { status(); nav(); document.getElementById("sub").textContent = "Espaces Verts · Cap Skirring"; return renderLogin(); }
  if (!U.view || (S.role !== "admin" && !["taches", "reglages"].includes(U.view))) U.view = S.role === "admin" ? "programme" : "taches";
  status(); nav();
  document.getElementById("sub").textContent = S.role === "admin" ? "Espace responsable" : "Espaces Verts · Cap Skirring";
  ({ taches: renderTaches, programme: renderProgramme, suivi: renderSuivi, briefing: renderBriefing, reglages: renderReglages })[U.view]();
}
function dateTabs(withPicker) {
  const t = iso(new Date());
  const days = [shift(t, -1), t, shift(t, 1)];
  return `<div class="seg" role="group" aria-label="Jour">${days.map(d => `<button data-act="date" data-d="${d}" aria-pressed="${U.date === d}">${rel(d)}</button>`).join("")}</div>
  ${withPicker ? `<div class="row" style="margin-top:8px"><label class="muted" for="autreJour">Autre jour :</label><input type="date" id="autreJour" data-in="date" value="${U.date}" style="width:auto;flex:1"></div>` : ""}
  <p class="muted" style="margin:8px 0 0">${longDate(U.date).replace(/^./, c => c.toUpperCase())}</p>`;
}
function equipeTabs() {
  return `<div class="seg" role="group" aria-label="Équipe">${[["jardin", "Jardin"], ["golf", "Golf"]].map(([k, l]) => `<button data-act="equipe" data-e="${k}" aria-pressed="${U.equipe === k}">${l}</button>`).join("")}</div>`;
}
function errBox() { return U.err ? `<div class="notice" style="margin-top:12px">${h(U.err)}</div>` : ""; }

function renderLogin() {
  main.innerHTML = `<div class="login">
    <p class="big" style="margin:0 0 6px">Bienvenue</p>
    <p class="muted">Entre le code de ton secteur. Le responsable entre son code administrateur.</p>
    <input type="text" id="code" autocomplete="off" autocapitalize="characters" aria-label="Code" placeholder="Code" style="margin:14px 0">
    <button class="btn primary wide" data-act="login" ${U.busy ? "disabled" : ""}>${U.busy ? "Vérification…" : "Entrer"}</button>
    ${U.codeErr ? `<div class="notice" style="margin-top:14px;text-align:left">${h(U.codeErr)}</div>` : ""}
    <p class="muted" style="margin-top:22px">La première connexion demande Internet. Ensuite, l’application s’ouvre et garde tes validations même sans réseau.</p>
  </div>`;
}

/* ----- Jardinier : mes tâches ----- */
function renderTaches() {
  const mes = S.secteurs;
  if (!U.sect || !secteur(U.sect)) U.sect = mes[0] && mes[0].id;
  const s = secteur(U.sect);
  if (!s) { main.innerHTML = `<p class="notice" style="margin-top:16px">Aucun secteur sur ce téléphone. Entre un code dans Réglages.</p>`; return; }
  const moi = S.moi[s.id];
  const list = tachesDe(s.id, U.date);
  const done = list.filter(fait).length;
  let html = "";
  if (mes.length > 1) html += `<div class="chips" style="margin-top:14px">${mes.map(x => `<button class="chip" data-act="sect" data-s="${x.id}" aria-pressed="${x.id === s.id}">${h(x.nom)}</button>`).join("")}</div>`;
  html += dateTabs(false) + errBox();
  html += `<div class="card" style="margin-top:14px"><div class="sect"><span class="name">${h(s.nom)}</span>${list.length ? `<span class="count">${done}/${list.length}</span>` : ""}</div>`;
  if (!moi) {
    html += `<label class="lbl">Qui es-tu ? Choisis ton nom une seule fois.</label><div class="chips">${s.jardiniers.map(n => `<button class="chip" data-act="moi" data-n="${h(n)}">${h(affNom(n))}</button>`).join("")}</div>`;
  } else {
    html += `<div class="who">Je suis ${h(affNom(moi))} <button class="link" data-act="moi" data-n="">Changer</button></div>`;
  }
  if (!list.length) html += `<p class="muted" style="margin-bottom:0">${S.synchro ? "Aucune tâche programmée pour ce jour." : "Les tâches arriveront dès que le téléphone aura du réseau."}</p>`;
  list.forEach(t => {
    html += `<div class="task">
      ${prio(t) || t.origine === "jardinier" || enAttente(t.id) ? `<div>${prio(t) ? '<span class="badge prio">Priorité</span>' : ""}${t.origine === "jardinier" ? '<span class="badge">Ajouté par l’équipe</span>' : ""}${enAttente(t.id) ? '<span class="badge wait">En attente d’envoi</span>' : ""}</div>` : ""}
      <div class="act">${h(t.activite)}</div>
      ${t.precision ? `<div>${h(t.precision)}</div>` : ""}
      ${t.pour ? `<div class="who">Pour : ${h(affNom(t.pour))}</div>` : ""}`;
    if (fait(t) || pasFait(t)) {
      html += `<div class="row"><span class="state ${fait(t) ? "done" : "ko"}">${fait(t) ? "✓ Fait" : "✗ Pas fait"}${t.fait_par ? " par " + h(affNom(t.fait_par)) : ""}${t.fait_le ? ", " + quand(t.fait_le) : ""}</span>
        <button class="btn ghost small" data-act="annuler" data-id="${t.id}" ${moi ? "" : "disabled"}>Modifier</button></div>
        ${t.remarque ? `<div class="muted">Remarque : ${h(t.remarque)}</div>` : ""}`;
    } else if (U.ko === t.id) {
      html += `<label class="lbl" for="rq">Pourquoi ? (facultatif)</label><textarea id="rq" placeholder="Ex. machine en panne, pluie, manque de produit"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn clay small" data-act="pasfait" data-id="${t.id}">Enregistrer « pas fait »</button><button class="btn ghost small" data-act="ko" data-id="">Annuler</button></div>`;
    } else {
      html += `<div class="row"><button class="btn primary" style="flex:2" data-act="fait" data-id="${t.id}" ${moi ? "" : "disabled"}>C’est fait</button>
        <button class="btn ghost" style="flex:1" data-act="ko" data-id="${t.id}" ${moi ? "" : "disabled"}>Pas fait</button></div>`;
    }
    html += `</div>`;
  });
  html += `</div>`;
  if (moi) html += addPanel(s, "jardinier");
  main.innerHTML = html;
}
function addPanel(s, mode) {
  const jard = mode === "jardinier";
  if (U.add !== s.id) return `<button class="btn ghost ${jard ? "wide" : "small"}" style="margin-top:${jard ? 14 : 10}px" data-act="add" data-s="${s.id}">${jard ? "+ Ajouter un travail que j’ai fait" : "+ Ajouter une tâche"}</button>`;
  return `<div class="add">
    <label class="lbl" for="addTitre">Travail</label>
    <input type="text" id="addTitre" placeholder="Ex. Entretien, Arrosage, Désherbage">
    <label class="lbl" for="addPrec">Description</label>
    <textarea id="addPrec" placeholder="${jard ? "Ex. massifs devant la réception" : "Ex. désherber et biner les massifs entre les deux portes"}"></textarea>
    ${jard ? "" : `<label class="lbl" for="addPour">Pour qui</label><select id="addPour"><option value="">Tout le secteur</option>${s.jardiniers.map(n => `<option value="${h(n)}">${h(affNom(n))}</option>`).join("")}</select>`}
    <div class="row" style="margin-top:12px"><button class="btn primary small" data-act="addOk" data-s="${s.id}" data-m="${mode}">${jard ? "Enregistrer comme fait" : "Ajouter"}</button>
    <button class="btn ghost small" data-act="add" data-s="">Fermer</button></div></div>`;
}

/* ----- Responsable : programme ----- */
function renderProgramme() {
  const secs = S.secteurs.filter(s => s.equipe === U.equipe);
  const hier = shift(U.date, -1);
  const reste = secs.reduce((n, s) => n + tachesDe(s.id, hier).filter(t => !fait(t)).length, 0);
  let html = dateTabs(true) + equipeTabs() + errBox();
  html += `<div class="row" style="margin-top:12px">
    <button class="btn ghost small" data-act="reprendre" ${reste ? "" : "disabled"}>Reprendre ${reste ? "les " + reste + " tâches" : "les tâches"} non faites la veille</button>
    <button class="btn ghost small" data-act="copier">Copier le programme de la veille</button></div>`;
  html += `<div class="stack" style="margin-top:14px">`;
  secs.forEach(s => {
    const list = tachesDe(s.id, U.date);
    html += `<div class="card"><div class="sect"><span class="name">${h(s.nom)}</span><span class="muted" style="margin-left:auto">${list.length ? list.length + " tâche" + (list.length > 1 ? "s" : "") : "Rien de programmé"}</span></div>
      <div class="who">${h(s.jardiniers.map(affNom).join(", "))}</div>
      ${s.missions ? `<div class="who">${h(s.missions)}</div>` : ""}<div style="margin-top:6px">`;
    list.forEach(t => {
      html += `<div class="tline"><div><strong>${h(t.activite)}</strong>${t.precision ? " · " + h(t.precision) : ""}${t.pour ? `<div class="who">Pour ${h(affNom(t.pour))}</div>` : ""}
        <div>${fait(t) ? '<span class="badge done">Fait</span>' : pasFait(t) ? '<span class="badge ko">Pas fait</span>' : ""}${enAttente(t.id) ? '<span class="badge wait">À envoyer</span>' : ""}</div></div>
        <button class="icon" data-act="prio" data-id="${t.id}" aria-pressed="${prio(t)}" aria-label="Priorité" title="Priorité">★</button>
        <button class="icon" data-act="suppr" data-id="${t.id}" aria-label="Supprimer" title="Supprimer">✕</button></div>`;
    });
    html += `</div>${addPanel(s, "admin")}</div>`;
  });
  main.innerHTML = html + `</div>`;
}

/* ----- Responsable : suivi ----- */
function renderSuivi() {
  const secs = S.secteurs.filter(s => s.equipe === U.equipe);
  let tot = 0, ok = 0;
  secs.forEach(s => { const l = tachesDe(s.id, U.date); tot += l.length; ok += l.filter(fait).length; });
  let html = dateTabs(false) + equipeTabs() + errBox();
  html += `<div class="card" style="margin-top:14px"><div class="row"><span class="big">${ok}/${tot}</span><span class="muted">tâches faites · ${U.equipe === "jardin" ? "Jardin" : "Golf"}</span></div>
    <div class="prog"><i style="width:${tot ? Math.round(ok / tot * 100) : 0}%"></i></div>
    <p class="muted" style="margin:8px 0 0">Données reçues ${S.synchro ? quand(S.synchro) : "jamais"}. Un jardinier sans réseau envoie ses validations dès qu’il en retrouve. Pour un jardinier sans téléphone, choisis son nom sous la tâche et valide à sa place.</p></div><div class="stack" style="margin-top:12px">`;
  secs.forEach(s => {
    const l = tachesDe(s.id, U.date);
    if (!l.length) return;
    const last = l.filter(t => t.fait_le).map(t => t.fait_le).sort().pop();
    html += `<div class="card"><div class="sect"><span class="name">${h(s.nom)}</span><span class="count">${l.filter(fait).length}/${l.length}</span></div>
      <div class="who">${last ? "Dernière validation " + quand(last) : "Aucune validation reçue"}</div><div style="margin-top:6px">`;
    l.forEach(t => {
      html += `<div class="tline" style="grid-template-columns:1fr"><div>${fait(t) ? '<span class="badge done">Fait</span>' : pasFait(t) ? '<span class="badge ko">Pas fait</span>' : '<span class="badge">À faire</span>'}${prio(t) ? '<span class="badge prio">Priorité</span>' : ""}${t.origine === "jardinier" ? '<span class="badge">Ajouté par l’équipe</span>' : ""}
        <strong>${h(t.activite)}</strong>${t.precision ? " · " + h(t.precision) : ""}
        ${t.fait_par ? `<div class="who">${h(affNom(t.fait_par))}${t.fait_le ? ", " + quand(t.fait_le) : ""}</div>` : ""}
        ${t.remarque ? `<div class="who">Remarque : ${h(t.remarque)}</div>` : ""}
        ${enAttente(t.id) ? '<span class="badge wait">À envoyer</span>' : ""}
        ${fait(t) || pasFait(t)
          ? `<div class="row" style="margin-top:6px"><button class="btn ghost small" data-act="annuler" data-id="${t.id}">Modifier</button></div>`
          : `<div class="row" style="margin-top:8px">
              <select id="sp_${t.id}" aria-label="Jardinier" style="flex:1;width:auto;min-width:150px">${s.jardiniers.map(n => `<option value="${h(n)}" ${n === (t.pour || s.jardiniers[0]) ? "selected" : ""}>${h(affNom(n))}</option>`).join("")}</select>
              <button class="btn primary small" data-act="sfait" data-id="${t.id}">Fait</button>
              <button class="btn ghost small" data-act="spasfait" data-id="${t.id}">Pas fait</button></div>`}
        </div></div>`;
    });
    html += `</div></div>`;
  });
  if (!tot) html += `<p class="muted">Rien de programmé pour ce jour.</p>`;
  main.innerHTML = html + `</div>`;
}

/* ----- Responsable : briefing ----- */
function B() { return S.brief[U.date] || (S.brief[U.date] = { cap: "", reprise: true, jardin: true, golf: true, sec: [], tech: "", clo: "", edit: null }); }
function capOptions() { return [["Général", LIBS.OBJ], ["Jardin", LIBS.OBJ_ACT.jardin], ["Golf", LIBS.OBJ_ACT.golf]]; }
function capTexte(label) { for (const [, l] of capOptions()) { const f = l.find(x => x[0] === label); if (f) return f[1]; } return ""; }
function texteBriefing() {
  const b = B(), out = [];
  out.push(`Bonjour à tous. Nous sommes ${longDate(U.date)}.`);
  if (b.cap) out.push(capTexte(b.cap));
  if (b.reprise) {
    const hier = shift(U.date, -1), parts = [];
    S.secteurs.forEach(s => { const l = tachesDe(s.id, hier).filter(t => !fait(t) && t.origine !== "jardinier"); if (l.length) parts.push(`${s.nom} : ${liste(l.map(t => phraseTache(s, t)))}`); });
    if (parts.length) out.push(`Hier, ces travaux ne sont pas terminés. ${parts.join(". ")}. Nous les reprenons aujourd’hui.`);
  }
  [["jardin", "Pour le jardin."], ["golf", "Pour le golf."]].forEach(([eq, titre]) => {
    if (!b[eq]) return;
    const lignes = [];
    S.secteurs.filter(s => s.equipe === eq).forEach(s => {
      const l = tachesDe(s.id, U.date).filter(t => t.origine !== "jardinier"); if (!l.length) return;
      const qui = s.jardiniers.length > 3 ? "toute l’équipe" : liste(s.jardiniers.map(affNom));
      const acts = l.map(t => phraseTache(s, t));
      lignes.push(`${l.some(prio) ? "En priorité, " : ""}${s.nom}, ${qui} : ${acts.length > 1 ? acts.slice(0, -1).join(", ") + ", puis " + acts[acts.length - 1] : acts[0]}.`);
    });
    if (lignes.length) out.push(titre + "\n" + lignes.join("\n"));
  });
  if (b.sec.length) { const t = b.sec.map(l => (LIBS.SEC.find(x => x[0] === l) || [0, ""])[1]).filter(Boolean); if (t.length) out.push("Pour la sécurité : " + t.join(" ; ") + "."); }
  if (b.tech) { const t = (LIBS.TECH.find(x => x[0] === b.tech) || [0, ""])[1]; if (t) out.push("Point technique : " + t); }
  if (b.clo) out.push((LIBS.CLO.find(x => x[0] === b.clo) || [0, ""])[1]);
  return out.filter(Boolean).join("\n\n");
}
function renderBriefing() {
  const b = B(), txt = b.edit != null ? b.edit : texteBriefing();
  const chips = (key, list, multi) => `<div class="chips">${list.map(x => `<button class="chip" data-act="bchip" data-k="${key}" data-l="${h(x[0])}" data-m="${multi ? 1 : 0}" aria-pressed="${multi ? b[key].includes(x[0]) : b[key] === x[0]}">${h(x[0])}</button>`).join("")}</div>`;
  let html = dateTabs(false) + errBox();
  html += `<p class="muted" style="margin-top:10px">Clique sur tes choix : le texte se construit avec les tâches programmées et ce qui reste d’hier. Données reçues ${S.synchro ? quand(S.synchro) : "jamais"}.</p>`;
  html += `<h2>Le cap du jour</h2>` + capOptions().map(([t, l]) => `<label class="lbl">${t}</label>` + chips("cap", l, false)).join("");
  html += `<h2>Contenu</h2><div class="chips">
    <button class="chip" data-act="btog" data-k="reprise" aria-pressed="${b.reprise}">Reprise d’hier</button>
    <button class="chip" data-act="btog" data-k="jardin" aria-pressed="${b.jardin}">Secteurs jardin</button>
    <button class="chip" data-act="btog" data-k="golf" aria-pressed="${b.golf}">Secteurs golf</button></div>`;
  html += `<h2>Sécurité</h2>` + chips("sec", LIBS.SEC, true);
  html += `<h2>Point technique</h2>` + chips("tech", LIBS.TECH, false);
  html += `<h2>Clôture</h2>` + chips("clo", LIBS.CLO, false);
  html += `<h2>Texte à lire devant l’équipe</h2>
    <textarea class="out" id="btxt" aria-label="Texte du briefing">${h(txt)}</textarea>
    ${b.edit != null ? `<p class="muted">Tu as modifié le texte à la main. Un nouveau clic sur un choix le reconstruit.</p>` : ""}
    <div class="row" style="margin-top:10px"><button class="btn primary" data-act="bcopy">Copier</button>
    ${"speechSynthesis" in window ? '<button class="btn ghost" data-act="bread">Lire à voix haute</button>' : ""}
    <button class="btn ghost" data-act="breset">Reconstruire</button></div>`;
  main.innerHTML = html;
}

/* ----- Réglages ----- */
function renderReglages() {
  let html = errBox();
  html += `<h2>Envoi des données</h2><div class="card"><p style="margin-top:0">${S.outbox.length ? S.outbox.length + " élément(s) en attente d’envoi." : "Tout est envoyé."}<br><span class="muted">Dernière mise à jour : ${S.synchro ? quand(S.synchro) : "jamais"}.</span></p>
    <button class="btn primary small" data-act="sync" ${navigator.onLine ? "" : "disabled"}>${navigator.onLine ? "Synchroniser maintenant" : "Pas de réseau"}</button></div>`;
  if (S.role === "admin") {
    html += `<h2>Codes des secteurs</h2><div class="card"><p class="muted" style="margin-top:0">Donne à chaque jardinier l’adresse de l’application et le code de son secteur. Ton code administrateur et les codes des chefs d’équipe se changent dans l’onglet Config du Google Sheet.</p>`;
    ["jardin", "golf"].forEach(eq => {
      html += `<label class="lbl">${eq === "jardin" ? "Jardin" : "Golf"}</label>`;
      S.secteurs.filter(s => s.equipe === eq).forEach(s => {
        html += `<div class="tline"><div>${h(s.nom)}</div><strong style="font-family:var(--display);font-size:20px;letter-spacing:.08em">${h(s.code || "")}</strong>
          <button class="btn ghost small" data-act="code" data-s="${s.id}" ${navigator.onLine ? "" : "disabled"}>Changer</button></div>`;
      });
    });
    html += `</div>`;
  } else {
    html += `<h2>Mes secteurs</h2><div class="card">${S.secteurs.map(s => `<div class="tline" style="grid-template-columns:1fr"><div>${h(s.nom)}</div></div>`).join("")}
      <label class="lbl" for="code2">Ajouter un autre secteur ou entrer un nouveau code</label><div class="row"><input type="text" id="code2" autocomplete="off" style="flex:1;width:auto"><button class="btn primary small" data-act="login2" ${U.busy ? "disabled" : ""}>Ajouter</button></div>
      ${U.codeErr ? `<div class="notice" style="margin-top:10px">${h(U.codeErr)}</div>` : ""}</div>`;
  }
  html += `<h2>Application</h2><div class="card stack">
    ${U.installEvt ? '<button class="btn primary" data-act="install">Installer sur ce téléphone</button>' : `<p class="muted" style="margin:0">Pour l’installer : menu du navigateur, puis « Ajouter à l’écran d’accueil ».</p>`}
    ${navigator.share ? '<button class="btn ghost" data-act="share">Partager l’adresse de l’application</button>' : ""}
    <button class="btn ghost" data-act="logout">Se déconnecter de ce téléphone</button></div>`;
  main.innerHTML = html;
}

/* ---------- actions ---------- */
function nouvelleTache(o) {
  return Object.assign({ id: "t" + uid(), date: U.date, secteur: "", activite: "", precision: "", pour: "", priorite: false, statut: "à faire", fait_par: "", fait_le: "", remarque: "", origine: "responsable" }, o);
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  const d = b.dataset, A = d.act;
  if (A === "login") return connexion(document.getElementById("code").value);
  if (A === "login2") { const v = document.getElementById("code2").value; U.view = "reglages"; await connexion(v); if (!U.codeErr) { U.view = "taches"; render(); } return; }
  if (A === "sync") { U.err = ""; return sync(); }
  if (A === "view") { U.view = d.v; U.add = null; U.ko = null; U.codeErr = ""; window.scrollTo(0, 0); return render(); }
  if (A === "date") { U.date = d.d; U.add = null; U.ko = null; return render(); }
  if (A === "equipe") { U.equipe = d.e; U.add = null; return render(); }
  if (A === "sect") { U.sect = d.s; U.add = null; U.ko = null; return render(); }
  if (A === "moi") { if (d.n) S.moi[U.sect] = d.n; else delete S.moi[U.sect]; save("moi"); return render(); }
  if (A === "fait" || A === "pasfait") {
    const t = Object.assign({}, S.taches[d.id]);
    t.statut = A === "fait" ? "fait" : "pas fait"; t.fait_par = S.moi[t.secteur] || ""; t.fait_le = new Date().toISOString();
    const rq = document.getElementById("rq");
    t.remarque = A === "pasfait" && rq ? rq.value.trim() : "";
    U.ko = null; return queue("valider", t);
  }
  if (A === "sfait" || A === "spasfait") {
    const t = Object.assign({}, S.taches[d.id]);
    const sel = document.getElementById("sp_" + d.id);
    let rq = "";
    if (A === "spasfait") { rq = prompt("Pourquoi ce n’est pas fait ? (facultatif)", ""); if (rq === null) return; }
    t.statut = A === "sfait" ? "fait" : "pas fait"; t.fait_par = sel ? sel.value : ""; t.fait_le = new Date().toISOString(); t.remarque = (rq || "").trim();
    return queue("valider", t);
  }
  if (A === "ko") { U.ko = d.id || null; return render(); }
  if (A === "annuler") return queue("valider", Object.assign({}, S.taches[d.id], { statut: "à faire", fait_par: "", fait_le: "", remarque: "" }));
  if (A === "add") { U.add = d.s || null; render(); const f = document.getElementById("addTitre"); if (f) f.focus(); return; }
  if (A === "addOk") {
    let act = (document.getElementById("addTitre").value || "").trim();
    let prec = (document.getElementById("addPrec").value || "").trim();
    if (!act && prec) { act = prec; prec = ""; }
    if (!act) return alert("Écris le travail à faire.");
    act = act.charAt(0).toUpperCase() + act.slice(1);
    if (d.m === "jardinier") {
      U.add = null;
      return queue("valider", nouvelleTache({ secteur: d.s, activite: act, precision: prec, statut: "fait", fait_par: S.moi[d.s] || "", fait_le: new Date().toISOString(), origine: "jardinier" }));
    }
    return queue("programmer", nouvelleTache({ secteur: d.s, activite: act, precision: prec, pour: document.getElementById("addPour").value }));
  }
  if (A === "prio") { const t = Object.assign({}, S.taches[d.id]); t.priorite = !prio(t); return queue("programmer", t); }
  if (A === "suppr") { const t = S.taches[d.id]; if (t && confirm("Supprimer « " + t.activite + " » ?")) queue("supprimer", { id: t.id, secteur: t.secteur }); return; }
  if (A === "reprendre" || A === "copier") {
    const hier = shift(U.date, -1); let n = 0;
    S.secteurs.filter(s => s.equipe === U.equipe).forEach(s => {
      const deja = tachesDe(s.id, U.date);
      tachesDe(s.id, hier).filter(t => (A === "copier" ? t.origine !== "jardinier" : !fait(t))).forEach(t => {
        if (deja.some(x => x.activite === t.activite && x.precision === t.precision)) return;
        n++; queue("programmer", nouvelleTache({ secteur: s.id, activite: t.activite, precision: t.precision, pour: t.pour, priorite: prio(t) }));
      });
    });
    if (!n) alert("Rien à ajouter : ces tâches sont déjà au programme.");
    return;
  }
  if (A === "bchip") {
    const bb = B();
    if (d.m === "1") { const i = bb[d.k].indexOf(d.l); i < 0 ? bb[d.k].push(d.l) : bb[d.k].splice(i, 1); }
    else bb[d.k] = bb[d.k] === d.l ? "" : d.l;
    bb.edit = null; save("brief"); return render();
  }
  if (A === "btog") { const bb = B(); bb[d.k] = !bb[d.k]; bb.edit = null; save("brief"); return render(); }
  if (A === "breset") { B().edit = null; save("brief"); return render(); }
  if (A === "bcopy") {
    const ta = document.getElementById("btxt");
    try { await navigator.clipboard.writeText(ta.value); } catch (er) { ta.select(); document.execCommand("copy"); }
    b.textContent = "Copié"; setTimeout(() => { b.textContent = "Copier"; }, 1500); return;
  }
  if (A === "bread") { const u = new SpeechSynthesisUtterance(document.getElementById("btxt").value); u.lang = "fr-FR"; speechSynthesis.cancel(); speechSynthesis.speak(u); return; }
  if (A === "code") {
    const s = secteur(d.s); const n = prompt("Nouveau code pour « " + s.nom + " » (4 caractères minimum) :", ""); if (!n) return;
    try {
      const r = await api({ action: "changerCode", codes: S.codes, secteur: s.id, nouveau: n });
      if (!r.ok) return alert(r.erreur);
      S.secteurs = r.secteurs; save("secteurs"); render();
      alert("Code changé. Donne le nouveau code aux jardiniers de ce secteur.");
    } catch (er) { alert("Changement impossible : vérifie le réseau."); }
    return;
  }
  if (A === "install") { U.installEvt.prompt(); U.installEvt = null; return render(); }
  if (A === "share") { try { await navigator.share({ title: "Briefing Espaces Verts", url: location.href.split("#")[0] }); } catch (er) {} return; }
  if (A === "logout") return deconnexion();
});
document.addEventListener("input", e => { if (e.target.id === "btxt") { B().edit = e.target.value; save("brief"); } });
document.addEventListener("change", e => { if (e.target.dataset.in === "date" && e.target.value) { U.date = e.target.value; U.add = null; render(); } });
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  if (e.target.id === "code") connexion(e.target.value);
  if (e.target.id === "code2") document.querySelector('[data-act="login2"]').click();
});
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); U.installEvt = e; if (U.view === "reglages") render(); });

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render(); sync();
