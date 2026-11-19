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
  moi: ls.get("moi", {}), brief: ls.get("brief", {}),
  ident: ls.get("ident", null), alertes: ls.get("alertes", []), appareil: ls.get("appareil", "")
};
if (!S.appareil) { S.appareil = "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); ls.set("appareil", S.appareil); }
const save = (...k) => k.forEach(x => ls.set(x, S[x]));
const U = { view: null, date: iso(new Date()), equipe: "jardin", sect: null, add: null, addAct: null, ko: null, err: "", busy: false, codeErr: "", installEvt: null, codes: null };
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
const annule = t => t.statut === "annulé";
const reporte = t => t.statut === "reporté";
function conflitDe(t) { if (!t || !t.conflit) return null; try { return typeof t.conflit === "string" ? JSON.parse(t.conflit) : t.conflit; } catch (e) { return null; } }
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
  return Object.values(S.taches).filter(t => t.secteur === sid && t.date === date && !annule(t))
    .sort((a, b) => (prio(b) - prio(a)) || String(a.id).localeCompare(String(b.id)));
}

/* ---------- synchronisation ---------- */
let syncing = false, syncTimer = null;
const enVol = new Set();
function queue(type, tache, extra) {
  const prev = S.taches[tache.id];
  const o = Object.assign({ op: uid(), type, tache: Object.assign({}, tache), cree: Date.now() }, extra || {});
  if (type === "valider" && o.base_statut === undefined) o.base_statut = prev ? (prev.statut || "à faire") : "à faire";
  if (type === "valider") {
    // Une seule validation en attente par tâche : évite les doubles validations.
    const j = S.outbox.findIndex(x => x.type === "valider" && x.tache.id === tache.id && !enVol.has(x.op));
    if (j >= 0) { o.base_statut = S.outbox[j].base_statut; o.cree = S.outbox[j].cree; S.outbox.splice(j, 1); }
  }
  S.outbox.push(o);
  if (type === "supprimer") { if (prev) S.taches[tache.id] = Object.assign({}, prev, { statut: "annulé" }); }
  else S.taches[tache.id] = tache;
  save("outbox", "taches"); render();
  clearTimeout(syncTimer); syncTimer = setTimeout(sync, 800);
}
async function api(body, delai) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), delai || 30000);
  try {
    const r = await fetch(API_URL, { method: "POST", body: JSON.stringify(Object.assign({ v: 2, appareil: S.appareil }, body)), signal: ctl.signal });
    return await r.json();
  } finally { clearTimeout(tm); }
}
async function sync() {
  if (!S.codes.length || syncing || !/^https:\/\//.test(API_URL)) return;
  if (!navigator.onLine) { status(); return; }
  syncing = true; status();
  let recus = new Set();
  try {
    // Une seule photo par envoi (réseau faible), dans l'ordre de la file.
    const ops = []; let avecPhoto = false;
    for (const o of S.outbox) {
      if (ops.length >= 150) break;
      if (o.type === "photo") {
        if (avecPhoto) break;
        const blob = await phGet("p:" + o.photo.pid);
        if (!blob) {
          if (await phDb()) { photoPerdue(o); continue; } // vraiment absente du téléphone
          break; // stockage momentanément inaccessible : on réessaiera plus tard
        }
        avecPhoto = true;
        ops.push(Object.assign({}, o, { photo: { pid: o.photo.pid, data: await enBase64(blob) } }));
      } else ops.push(o);
    }
    ops.forEach(o => enVol.add(o.op));
    const r = await api({ action: "synchro", codes: S.codes, ops }, avecPhoto ? 120000 : 30000);
    if (!r.ok) throw new Error(messageErreur(r.erreur, true));
    recus = new Set(r.resultats ? r.resultats.filter(x => x.etat !== "reessayer").map(x => x.op) : (r.recus || []));
    let aRenvoyer = "";
    (r.resultats || []).forEach(x => {
      if (x.etat === "ok") return;
      const o = S.outbox.find(y => y.op === x.op);
      const t = o && (S.taches[o.tache.id] || o.tache);
      const nom = t && t.activite ? "« " + t.activite + " »" : "Une tâche";
      if (x.etat === "reessayer") { aRenvoyer = "Une photo de " + nom + " n’est pas encore enregistrée (" + x.raison + "). Elle reste dans le téléphone et sera renvoyée."; return; }
      S.alertes.push({ le: new Date().toISOString(), texte: x.etat === "conflit"
        ? nom + " : " + x.raison + ". Les deux informations sont gardées, à vérifier dans le Suivi."
        : o && o.type === "photo" ? "La photo de " + nom + " n’a pas été enregistrée : " + x.raison + "."
        : nom + " n’a pas été enregistrée : " + x.raison + "." });
      if (o && o.type === "photo") phDel("p:" + o.photo.pid);
    });
    const photosRecues = S.outbox.filter(o => o.type === "photo" && recus.has(o.op)).map(o => o.photo.pid);
    S.alertes = S.alertes.slice(-20);
    S.outbox = S.outbox.filter(o => !recus.has(o.op));
    const n = {};
    (r.taches || []).forEach(t => { n[t.id] = t; });
    S.outbox.forEach(o => {
      if (o.type === "supprimer") { if (n[o.tache.id]) n[o.tache.id] = Object.assign({}, n[o.tache.id], { statut: "annulé" }); }
      else if (S.taches[o.tache.id]) n[o.tache.id] = S.taches[o.tache.id];
    });
    await rangerPhotosEnvoyees(photosRecues, n);
    S.taches = n; S.secteurs = r.secteurs || S.secteurs; S.role = r.role || S.role; S.synchro = r.heure;
    if (r.moi) S.ident = r.moi;
    U.err = aRenvoyer;
    setTimeout(prechargerPhotos, 500);
    save("outbox", "taches", "secteurs", "role", "synchro", "ident", "alertes");
  } catch (e) {
    U.err = e.name === "AbortError" ? "Réseau trop lent : les validations restent dans le téléphone et partiront plus tard." :
      (e instanceof TypeError ? "Pas de réseau pour le moment : les validations partiront plus tard." : e.message);
  }
  enVol.clear();
  syncing = false;
  if (!U.err && S.outbox.length && recus.size) return sync();
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
function messageErreur(err, deja) {
  if (err === "Code inconnu") return deja ? "Ton code n’est plus valable. Demande le nouveau code à ton responsable, puis entre-le dans Réglages." : "Ce code n’existe pas. Vérifie-le avec ton responsable.";
  if (err === "Trop d’essais") return "Trop d’essais de codes incorrects sur l’application. Par sécurité, réessaie dans 15 minutes.";
  return err || "Erreur du serveur.";
}
function demanderPersistance() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {} }
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
    if (!r.ok) throw new Error(messageErreur(r.erreur, false));
    if (!S.codes.map(c => c.toUpperCase()).includes(code.toUpperCase())) S.codes.push(code);
    const nouveaux = r.secteurs.filter(x => !S.secteurs.some(y => y.id === x.id));
    S.role = r.role === "admin" || S.role === "admin" ? "admin" : "secteur";
    S.secteurs = S.role === "admin" && r.role === "admin" ? r.secteurs : S.secteurs.concat(nouveaux);
    if (r.moi && (r.role === "admin" || !S.ident)) S.ident = r.moi;
    save("codes", "role", "secteurs", "ident");
    demanderPersistance();
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
  ["codes", "role", "secteurs", "taches", "outbox", "synchro", "ident", "alertes"].forEach(k => { try { localStorage.removeItem(K + k); } catch (e) {} });
  S.codes = []; S.role = null; S.secteurs = []; S.taches = {}; S.outbox = []; S.synchro = null; S.ident = null; S.alertes = []; U.codes = null;
  phVider();
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
  document.getElementById("sub").textContent = S.role === "admin" ? "Espace responsable" + (S.ident && S.ident.nom ? " · " + affNom(S.ident.nom) : "") : "Espaces Verts · Cap Skirring";
  ({ taches: renderTaches, programme: renderProgramme, suivi: renderSuivi, briefing: renderBriefing, reglages: renderReglages })[U.view]();
  setTimeout(chargerPhotos, 0);
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
function errBox() {
  let s = U.err ? `<div class="notice" style="margin-top:12px">${h(U.err)}</div>` : "";
  const n = S.outbox.length;
  if (n) {
    const vieux = Math.min.apply(null, S.outbox.map(o => o.cree || Date.now()));
    const longtemps = Date.now() - vieux >= 24 * 3600000;
    s += `<div class="notice" style="margin-top:12px${longtemps ? ";border:2px solid var(--clay)" : ""}"><strong>${n} ${n > 1 ? "envois" : "envoi"} en attente.</strong>
      ${longtemps ? "Certains attendent depuis plus de 24 h : connecte ce téléphone à Internet dès que possible." : "Ils partiront dès que le réseau revient. Rien n’est perdu."}
      <div class="row" style="margin-top:8px"><button class="btn primary small" data-act="sync" ${syncing ? "disabled" : ""}>${syncing ? "Envoi…" : "Synchroniser maintenant"}</button></div></div>`;
  }
  if (S.alertes.length) {
    s += `<div class="notice" style="margin-top:12px"><strong>À savoir</strong>${S.alertes.map(a => `<div style="margin-top:6px">${h(a.texte)}</div>`).join("")}
      <div class="row" style="margin-top:8px"><button class="btn ghost small" data-act="alertesOk">J’ai compris</button></div></div>`;
  }
  return s;
}

function renderLogin() {
  main.innerHTML = `<div class="login">
    <p class="big" style="margin:0 0 6px">Bienvenue</p>
    <p class="muted">Entre le code de ton secteur. Le responsable et les chefs d’équipe entrent leur code personnel.</p>
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
      ${prio(t) || t.origine === "jardinier" || enAttente(t.id) || t.conflit ? `<div>${prio(t) ? '<span class="badge prio">Priorité</span>' : ""}${t.origine === "jardinier" ? '<span class="badge">Ajouté par l’équipe</span>' : ""}${enAttente(t.id) ? '<span class="badge wait">En attente d’envoi</span>' : ""}${t.conflit ? '<span class="badge ko">Vérification par le responsable</span>' : ""}</div>` : ""}
      <div class="act">${h(t.activite)}</div>
      ${t.precision ? `<div>${h(t.precision)}</div>` : ""}
      ${t.pour ? `<div class="who">Pour : ${h(affNom(t.pour))}</div>` : ""}
      ${phBloc(t, true)}`;
    if (reporte(t)) {
      html += `<div class="row"><span class="state">↷ Reportée à un autre jour</span></div>`;
    } else if (fait(t) || pasFait(t)) {
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
const aReprendre = t => !fait(t) && !reporte(t) && !t.reporte_vers && t.origine !== "jardinier";
function renderProgramme() {
  const secs = S.secteurs.filter(s => s.equipe === U.equipe);
  const hier = shift(U.date, -1);
  const reste = secs.reduce((n, s) => n + tachesDe(s.id, hier).filter(aReprendre).length, 0);
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
        <div>${fait(t) ? '<span class="badge done">Fait</span>' : pasFait(t) ? '<span class="badge ko">Pas fait</span>' : reporte(t) ? '<span class="badge">Reporté</span>' : ""}${t.conflit ? '<span class="badge ko">À vérifier</span>' : ""}${enAttente(t.id) ? '<span class="badge wait">À envoyer</span>' : ""}</div>
        ${phBloc(t, false)}${photosDe(t).length < PHOTOS_MAX ? `<div class="phadd"><button class="btn ghost small" data-act="photo" data-mode="camera" data-id="${t.id}">📷 Prendre une photo</button><button class="btn ghost small" data-act="photo" data-mode="galerie" data-id="${t.id}">🖼️ Galerie</button>${photosDe(t).length ? `<span class="who">${photosDe(t).length}/${PHOTOS_MAX}</span>` : ""}</div>` : `<div class="who">${PHOTOS_MAX} photos (maximum)</div>`}</div>
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
      const c = conflitDe(t);
      html += `<div class="tline" style="grid-template-columns:1fr"><div>${fait(t) ? '<span class="badge done">Fait</span>' : pasFait(t) ? '<span class="badge ko">Pas fait</span>' : reporte(t) ? '<span class="badge">Reporté</span>' : '<span class="badge">À faire</span>'}${prio(t) ? '<span class="badge prio">Priorité</span>' : ""}${t.origine === "jardinier" ? '<span class="badge">Ajouté par l’équipe</span>' : ""}
        <strong>${h(t.activite)}</strong>${t.precision ? " · " + h(t.precision) : ""}
        ${t.fait_par ? `<div class="who">${h(affNom(t.fait_par))}${t.fait_le ? ", " + quand(t.fait_le) : ""}</div>` : ""}
        ${(fait(t) || pasFait(t)) && t.valide_par && t.valide_fonction && t.valide_fonction !== "Jardinier" ? `<div class="who">Validé par ${h(affNom(t.valide_par))} (${h(t.valide_fonction)})${t.valide_le ? ", " + quand(t.valide_le) : ""}</div>` : ""}
        ${t.remarque ? `<div class="who">Remarque : ${h(t.remarque)}</div>` : ""}
        ${phBloc(t, false)}
        ${enAttente(t.id) ? '<span class="badge wait">À envoyer</span>' : ""}
        ${c ? `<div class="notice" style="margin-top:6px"><strong>À vérifier :</strong> une autre information est arrivée pour cette tâche : « ${h(c.statut)} »${c.fait_par ? " par " + h(affNom(c.fait_par)) : ""}${c.remarque ? " (" + h(c.remarque) + ")" : ""}, envoyée${c.par ? " par " + h(affNom(c.par)) : ""}${c.le ? " " + quand(c.le) : ""}.
          <div class="row" style="margin-top:8px"><button class="btn ghost small" data-act="garder" data-c="actuel" data-id="${t.id}">Garder « ${h(t.statut)} »</button><button class="btn ghost small" data-act="garder" data-c="autre" data-id="${t.id}">Garder « ${h(c.statut)} »</button></div></div>` : ""}
        ${reporte(t) ? "" : fait(t) || pasFait(t)
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
    if (S.ident && S.ident.nom) html += `<h2>Connecté</h2><div class="card"><strong>${h(affNom(S.ident.nom))}</strong><div class="who">${h(S.ident.fonction || "")}</div></div>`;
    html += `<h2>Codes des secteurs</h2><div class="card"><p class="muted" style="margin-top:0">Donne à chaque jardinier l’adresse de l’application et le code de son secteur. Les codes personnels du responsable et des chefs d’équipe sont dans l’onglet Utilisateurs du Google Sheet.</p>
      ${U.codes ? "" : `<p class="muted">${navigator.onLine ? "Chargement des codes…" : "Les codes s’affichent quand le téléphone a du réseau."}</p>`}`;
    ["jardin", "golf"].forEach(eq => {
      html += `<label class="lbl">${eq === "jardin" ? "Jardin" : "Golf"}</label>`;
      S.secteurs.filter(s => s.equipe === eq).forEach(s => {
        html += `<div class="tline"><div>${h(s.nom)}</div><strong style="font-family:var(--display);font-size:20px;letter-spacing:.08em">${h(U.codes ? (U.codes[s.id] || "") : (s.code || ""))}</strong>
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
  if (A === "view") { U.view = d.v; U.add = null; U.ko = null; U.codeErr = ""; window.scrollTo(0, 0); render(); if (d.v === "reglages" && S.role === "admin") chargerCodes(); return; }
  if (A === "alertesOk") { S.alertes = []; save("alertes"); return render(); }
  if (A === "garder") {
    const t = S.taches[d.id], c = conflitDe(t); if (!t) return;
    const n = Object.assign({}, t, { conflit: "" });
    if (d.c === "autre" && c) Object.assign(n, { statut: c.statut, fait_par: c.fait_par, fait_le: c.fait_le, remarque: c.remarque });
    return queue("resoudre", n, { choix: d.c === "autre" ? "autre" : "actuel" });
  }
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
      tachesDe(s.id, hier).filter(t => (A === "copier" ? t.origine !== "jardinier" : aReprendre(t))).forEach(t => {
        // Identifiant fixe : si deux responsables reprennent en même temps, la tâche n’est créée qu’une fois.
        const nid = (A === "reprendre" ? "r_" : "c_") + t.id + "_" + U.date;
        if (S.taches[nid] || deja.some(x => x.activite === t.activite && x.precision === t.precision)) return;
        if (A === "reprendre") S.taches[t.id] = Object.assign({}, t, { reporte_vers: nid }, t.statut === "à faire" || !t.statut ? { statut: "reporté" } : {});
        const ph = photosDe(t).filter(x => x.f);
        n++; queue("programmer", nouvelleTache(Object.assign({ id: nid, secteur: s.id, activite: t.activite, precision: t.precision, pour: t.pour, priorite: prio(t) },
          A === "reprendre" ? { report_de: t.id } : { copie_de: t.id }, ph.length ? { photos: ph } : {})));
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
    const s = secteur(d.s); const n = prompt("Nouveau code pour « " + s.nom + " » (6 chiffres ou plus) :", ""); if (!n) return;
    try {
      const r = await api({ action: "changerCode", codes: S.codes, secteur: s.id, nouveau: n.trim() });
      if (!r.ok) return alert(r.erreur);
      if (r.codes) { U.codes = {}; r.codes.forEach(x => U.codes[x.id] = x.code); }
      if (r.secteurs) { S.secteurs = r.secteurs; save("secteurs"); }
      render();
      alert("Code changé. Donne le nouveau code aux jardiniers de ce secteur.");
    } catch (er) { alert("Changement impossible : vérifie le réseau."); }
    return;
  }
  if (A === "photo") {
    if (photosDe(S.taches[d.id]).length >= PHOTOS_MAX) return alert(PHOTOS_MAX + " photos au maximum par tâche.");
    // « Prendre une photo » ouvre directement l'appareil photo ; « Galerie » ouvre les photos du téléphone.
    const champ = d.mode === "camera" ? champCamera : champPhoto;
    U.photoPour = d.id; champ.value = ""; champ.click(); return;
  }
  if (A === "phVoir") return ouvrirPhoto(d.id, Number(d.i));
  if (A === "phFermer") return fermerPhoto(true);
  if (A === "phZoom") { if (U.voir) { U.voir.z = Math.max(1, Math.min(4, U.voir.z + Number(d.z))); afficherPhoto(); } return; }
  if (A === "phNav") { if (U.voir) { const n = photosDe(S.taches[U.voir.id]).length; U.voir.i = (U.voir.i + Number(d.n) + n) % n; U.voir.z = 1; afficherPhoto(); } return; }
  if (A === "phSuppr") return supprimerPhoto();
  if (A === "install") { U.installEvt.prompt(); U.installEvt = null; return render(); }
  if (A === "share") { try { await navigator.share({ title: "Briefing Espaces Verts", url: location.href.split("#")[0] }); } catch (er) {} return; }
  if (A === "logout") return deconnexion();
});
document.addEventListener("input", e => { if (e.target.id === "btxt") { B().edit = e.target.value; save("brief"); } });
document.addEventListener("change", e => { if (e.target.dataset.in === "date" && e.target.value) { U.date = e.target.value; U.add = null; render(); } });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && U.voir) return fermerPhoto(true);
  if (e.key !== "Enter") return;
  if (e.target.id === "code") connexion(e.target.value);
  if (e.target.id === "code2") document.querySelector('[data-act="login2"]').click();
});
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); U.installEvt = e; if (U.view === "reglages") render(); });

/* ---------- photos ---------- */
const PHOTOS_MAX = 3;
const PHOTO_TAILLE = 1600; // pixels sur le grand côté : assez pour bien voir les détails
function photosDe(t) {
  if (!t || !t.photos) return [];
  if (Array.isArray(t.photos)) return t.photos;
  try { const a = JSON.parse(t.photos); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
const phCle = x => x.f ? "f:" + x.f : "p:" + x.p;
// Les photos sont gardées dans le téléphone (IndexedDB) : visibles sans réseau, et une photo prise
// hors connexion attend là jusqu'à son envoi.
const PH = { db: null, mem: {}, url: {}, enCours: new Set(), absentes: new Set() };
function phDb() {
  if (PH.db) return PH.db;
  PH.db = new Promise(res => {
    try {
      const q = indexedDB.open("bev_photos", 1);
      q.onupgradeneeded = () => q.result.createObjectStore("p");
      q.onsuccess = () => res(q.result); q.onerror = () => res(null); q.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return PH.db;
}
function phTx(mode, f) {
  return phDb().then(db => !db ? null : new Promise(res => {
    try { const tx = db.transaction("p", mode); const r = f(tx.objectStore("p")); tx.oncomplete = () => res(r && "result" in r ? r.result : true); tx.onerror = tx.onabort = () => res(null); }
    catch (e) { res(null); }
  }));
}
async function phGet(k) { if (PH.mem[k]) return PH.mem[k]; return (await phTx("readonly", st => st.get(k))) || null; }
async function phPut(k, blob) { PH.mem[k] = blob; const ok = await phTx("readwrite", st => { st.put(blob, k); }); if (ok) delete PH.mem[k]; return !!ok || !!PH.mem[k]; }
async function phDel(k) { delete PH.mem[k]; if (PH.url[k]) { URL.revokeObjectURL(PH.url[k]); delete PH.url[k]; } await phTx("readwrite", st => { st.delete(k); }); }
async function phCles() { return (await phTx("readonly", st => st.getAllKeys())) || []; }
function phVider() { PH.mem = {}; Object.values(PH.url).forEach(u => URL.revokeObjectURL(u)); PH.url = {}; phTx("readwrite", st => { st.clear(); }); }
function enBase64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); }); }
function depuisBase64(b64) { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type: "image/jpeg" }); }

/* Réduit la photo à 1600 pixels (grand côté), qualité 85 % : nette, mais légère à envoyer. */
async function reduirePhoto(file) {
  let src, w, hh;
  try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); w = src.width; hh = src.height; }
  catch (e) {
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    w = src.naturalWidth; hh = src.naturalHeight;
  }
  const k = Math.min(1, PHOTO_TAILLE / Math.max(w, hh));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(hh * k);
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return await new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
}
const champPhoto = document.createElement("input");
champPhoto.type = "file"; champPhoto.accept = "image/*"; champPhoto.hidden = true;
const champCamera = document.createElement("input");
champCamera.type = "file"; champCamera.accept = "image/*"; champCamera.setAttribute("capture", "environment"); champCamera.hidden = true;
document.body.appendChild(champPhoto); document.body.appendChild(champCamera);
champPhoto.addEventListener("change", () => photoChoisie(champPhoto));
champCamera.addEventListener("change", () => photoChoisie(champCamera));
async function photoChoisie(champ) {
  const file = champ.files && champ.files[0], tid = U.photoPour; U.photoPour = null;
  const t = S.taches[tid]; if (!file || !t) return;
  let blob;
  try { blob = await reduirePhoto(file); } catch (e) { blob = null; }
  if (!blob) return alert("Cette photo n’a pas pu être lue. Essaie avec une autre photo.");
  const pid = "p" + uid();
  if (!(await phPut("p:" + pid, blob))) return alert("Le téléphone n’a pas pu garder la photo. Libère de la place et réessaie.");
  const n = Object.assign({}, S.taches[tid]);
  n.photos = photosDe(n).concat([{ p: pid, par: S.ident && S.ident.nom || "", le: new Date().toISOString() }]);
  S.taches[tid] = n;
  S.outbox.push({ op: uid(), type: "photo", tache: { id: tid, secteur: n.secteur }, photo: { pid }, cree: Date.now() });
  save("outbox", "taches"); render();
  clearTimeout(syncTimer); syncTimer = setTimeout(sync, 800);
}
function photoPerdue(o) {
  S.outbox = S.outbox.filter(x => x !== o);
  const t = S.taches[o.tache.id];
  if (t) S.taches[o.tache.id] = Object.assign({}, t, { photos: photosDe(t).filter(x => x.p !== o.photo.pid || x.f) });
  S.alertes.push({ le: new Date().toISOString(), texte: "Une photo de « " + (t ? t.activite : "une tâche") + " » n’a pas pu être retrouvée dans le téléphone. Reprends-la." });
}
/* Après l'envoi, la photo gardée dans le téléphone prend la référence Drive : pas besoin de la retélécharger. */
async function rangerPhotosEnvoyees(pids, taches) {
  for (const pid of pids) {
    let f = null;
    Object.values(taches).some(t => photosDe(t).some(x => { if (x.p === pid && x.f) { f = x.f; return true; } return false; }));
    const blob = await phGet("p:" + pid);
    if (f && blob) await phPut("f:" + f, blob);
    await phDel("p:" + pid);
  }
}
function phImg(k, alt) {
  if (PH.url[k]) return `<img src="${PH.url[k]}" alt="${h(alt)}">`;
  return `<span class="phwait">${PH.absentes.has(k) ? "Photo indisponible" : navigator.onLine || k.startsWith("p:") ? "Chargement de la photo…" : "Photo visible quand le téléphone aura du réseau"}</span>`;
}
function phBloc(t, grand) {
  const l = photosDe(t); if (!l.length) return "";
  return `<div class="phs ${grand ? "grand" : "petit"}">${l.map((x, i) => `<button class="ph" data-act="phVoir" data-id="${h(t.id)}" data-i="${i}" data-k="${h(phCle(x))}" aria-label="Agrandir la photo ${i + 1}">${phImg(phCle(x), "Photo " + (i + 1) + " : " + (t.activite || ""))}</button>`).join("")}</div>
    ${grand ? `<div class="who">Touche la photo pour l’agrandir.</div>` : ""}`;
}
function phMontrer(k) {
  document.querySelectorAll(".ph[data-k]").forEach(b => { if (b.dataset.k === k) b.innerHTML = phImg(k, b.getAttribute("aria-label") || "Photo"); });
  if (U.voir) afficherPhoto();
}
/* Affiche les photos de l'écran : d'abord depuis le téléphone, sinon depuis le serveur (3 par demande). */
async function chargerPhotos(cles) {
  cles = cles || Array.from(new Set(Array.from(document.querySelectorAll(".ph[data-k]")).map(b => b.dataset.k)));
  const aDemander = [];
  for (const k of cles) {
    if (PH.url[k] || PH.enCours.has(k)) continue;
    const blob = await phGet(k);
    if (blob) { PH.url[k] = URL.createObjectURL(blob); phMontrer(k); }
    else if (k.startsWith("f:") && !PH.absentes.has(k)) aDemander.push(k);
  }
  if (!aDemander.length || !navigator.onLine || !S.codes.length || !/^https:\/\//.test(API_URL)) return;
  aDemander.forEach(k => PH.enCours.add(k));
  try {
    for (let i = 0; i < aDemander.length; i += 3) {
      const lot = aDemander.slice(i, i + 3);
      const r = await api({ action: "photos", codes: S.codes, ids: lot.map(k => k.slice(2)) }, 90000);
      if (!r.ok) break;
      for (const k of lot) {
        const b64 = r.photos && r.photos[k.slice(2)];
        if (b64) { const blob = depuisBase64(b64); await phPut(k, blob); PH.url[k] = URL.createObjectURL(blob); }
        else if ((r.absentes || []).includes(k.slice(2))) PH.absentes.add(k);
        phMontrer(k);
      }
    }
  } catch (e) {}
  aDemander.forEach(k => PH.enCours.delete(k));
}
/* Après chaque synchronisation : garde dans le téléphone les photos des tâches d'hier à après-demain,
   pour les voir même sans réseau, et efface celles qui ne servent plus. */
async function prechargerPhotos() {
  const hier = shift(iso(new Date()), -1), apres = shift(iso(new Date()), 2), utiles = new Set(), aCharger = [];
  Object.values(S.taches).forEach(t => photosDe(t).forEach(x => {
    utiles.add(phCle(x));
    if (!annule(t) && t.date >= hier && t.date <= apres) aCharger.push(phCle(x));
  }));
  S.outbox.forEach(o => { if (o.type === "photo") utiles.add("p:" + o.photo.pid); });
  // Seules les photos déjà envoyées (f:) sont effacées ; une photo pas encore envoyée n'est jamais effacée ici.
  if (Object.keys(S.taches).length) for (const k of await phCles()) if (k.startsWith("f:") && !utiles.has(k)) await phDel(k);
  await chargerPhotos(aCharger.filter(k => k.startsWith("f:")));
}
/* Plein écran, avec zoom */
function ouvrirPhoto(id, i) {
  U.voir = { id, i: i || 0, z: 1 };
  try { history.pushState({ photo: 1 }, ""); } catch (e) {}
  afficherPhoto();
}
function fermerPhoto(retour) {
  if (!U.voir) return;
  U.voir = null; const v = document.getElementById("viewer"); if (v) v.remove();
  if (retour) try { if (history.state && history.state.photo) history.back(); } catch (e) {}
}
window.addEventListener("popstate", () => { if (U.voir) fermerPhoto(false); });
function afficherPhoto() {
  const t = S.taches[U.voir.id], l = photosDe(t);
  if (!l.length) return fermerPhoto(true);
  if (U.voir.i >= l.length) U.voir.i = l.length - 1;
  const x = l[U.voir.i], k = phCle(x), z = U.voir.z;
  let v = document.getElementById("viewer");
  if (!v) { v = document.createElement("div"); v.id = "viewer"; v.setAttribute("role", "dialog"); v.setAttribute("aria-modal", "true"); v.setAttribute("aria-label", "Photo"); document.body.appendChild(v); }
  if (!PH.url[k]) chargerPhotos([k]);
  v.innerHTML = `<div class="vbar"><button class="btn ghost small" data-act="phFermer">✕ Fermer</button>
      <span class="vt">${h(t.activite || "")}${l.length > 1 ? " · " + (U.voir.i + 1) + "/" + l.length : ""}</span>
      <button class="btn ghost small" data-act="phZoom" data-z="-1" ${z <= 1 ? "disabled" : ""} aria-label="Réduire">－</button>
      <button class="btn ghost small" data-act="phZoom" data-z="1" ${z >= 4 ? "disabled" : ""} aria-label="Agrandir">＋</button></div>
    <div class="vimg ${z > 1 ? "zoom" : ""}">${PH.url[k] ? `<img src="${PH.url[k]}" alt="Photo ${U.voir.i + 1}" style="${z > 1 ? "width:" + z * 100 + "%" : ""}">` : `<span class="phwait">${phImg(k, "")}</span>`}</div>
    <div class="vbar">${l.length > 1 ? `<button class="btn ghost small" data-act="phNav" data-n="-1">‹ Précédente</button><button class="btn ghost small" data-act="phNav" data-n="1">Suivante ›</button>` : ""}
      ${S.role === "admin" ? `<button class="btn clay small" style="margin-left:auto" data-act="phSuppr">Retirer cette photo</button>` : ""}</div>
    ${x.par ? `<div class="vt" style="padding:0 12px 12px">Photo de ${h(affNom(x.par))}${x.le ? ", " + quand(x.le) : ""}</div>` : ""}`;
}
function supprimerPhoto() {
  if (!U.voir || S.role !== "admin") return;
  const t = S.taches[U.voir.id], l = photosDe(t), x = l[U.voir.i];
  if (!x || !confirm("Retirer cette photo de la tâche ?")) return;
  const n = Object.assign({}, t, { photos: l.filter(y => y !== x) });
  S.taches[t.id] = n;
  const attente = !x.f && S.outbox.find(o => o.type === "photo" && o.photo.pid === x.p && !enVol.has(o.op));
  if (attente) { S.outbox = S.outbox.filter(o => o !== attente); phDel("p:" + x.p); }
  else S.outbox.push({ op: uid(), type: "photoSuppr", tache: { id: t.id, secteur: t.secteur }, photo: x.f ? { f: x.f } : { pid: x.p }, cree: Date.now() });
  save("outbox", "taches");
  if (!n.photos.length) fermerPhoto(true); else afficherPhoto();
  render(); clearTimeout(syncTimer); syncTimer = setTimeout(sync, 800);
}
document.head.insertAdjacentHTML("beforeend", `<style>
.phs.grand{display:grid;gap:8px}
.phadd{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}
.phs.petit{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.ph{border:0;padding:0;background:var(--surface2);border-radius:10px;overflow:hidden;cursor:zoom-in;display:block;color:var(--muted)}
.phs.grand .ph{width:100%;min-height:120px}
.phs.grand .ph img{display:block;width:100%;height:auto;max-height:75vh;object-fit:contain;background:#000}
.phs.petit .ph{width:88px;height:88px}
.phs.petit .ph img{width:100%;height:100%;object-fit:cover;display:block}
.phwait{display:flex;align-items:center;justify-content:center;min-height:inherit;height:100%;padding:10px;font-size:13px;text-align:center}
#viewer{position:fixed;inset:0;z-index:20;background:#000;color:#fff;display:flex;flex-direction:column;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
#viewer .vbar{display:flex;gap:8px;align-items:center;padding:10px 12px;flex-wrap:wrap}
#viewer .vt{font-size:14px;opacity:.85;flex:1;min-width:0}
#viewer .vimg{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;-webkit-overflow-scrolling:touch}
#viewer .vimg.zoom{display:block}
#viewer .vimg img{max-width:100%;max-height:100%;object-fit:contain;display:block;margin:auto}
#viewer .vimg.zoom img{max-width:none;max-height:none;height:auto}
#viewer .btn.ghost{background:#2a2a2a;color:#fff;border-color:#444}
</style>`);

async function chargerCodes() {
  if (!navigator.onLine || S.role !== "admin") return;
  try {
    const r = await api({ action: "codes", codes: S.codes });
    if (r.ok && r.codes) { U.codes = {}; r.codes.forEach(x => U.codes[x.id] = x.code); if (U.view === "reglages") render(); }
  } catch (e) {}
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (S.codes.length) demanderPersistance();
render(); sync();
