/* =====================================================================
   js/hud.js  —  interface 2D : toasts, pastilles d'état, objectifs,
                 FEUILLE DE RELEVÉS (modal « papier » à remplir à la main),
                 export CSV, barre de chat et flash rouge des coups.

   La feuille n'est plus un tableau automatique : les cases sont VIDES et
   se remplissent au clavier, avec une police manuscrite, sur un fond de
   papier ligné.
   ===================================================================== */
import { S, $, fr, ME, ctx } from './state.js';
import { sfx } from './audio.js';
import { missionsDef } from './circuit.js';

/* ------------------------------------------------------------------ */
/*  Toasts                                                             */
/* ------------------------------------------------------------------ */
const TOAST_COLORS = {
    info: 'rgba(34,211,238,.28)', success: 'rgba(52,211,153,.28)',
    warn: 'rgba(251,191,36,.3)', error: 'rgba(248,113,113,.34)'
};
const TOAST_ICONS = { info: 'info', success: 'check-circle-2', warn: 'alert-triangle', error: 'ban' };
const LS_PAPER = 'labo3d_paper_v1';

export function savePaperState() {
    try {
        localStorage.setItem(LS_PAPER, JSON.stringify({
            rows,
            sheets,
            fName: $('fName')?.value || '',
            fDate: $('fDate')?.value || '',
            fPoste: $('fPoste')?.value || ''
        }));
    } catch (e) { /* private mode */ }
}
export function loadPaperState() {
    try {
        const raw = localStorage.getItem(LS_PAPER);
        if (!raw) return;
        const o = JSON.parse(raw);
        if (Array.isArray(o.rows))   rows.push(...o.rows);
        if (Array.isArray(o.sheets)) sheets.push(...o.sheets);
        if (o.fName  && $('fName'))  $('fName').value  = o.fName;
        if (o.fDate  && $('fDate'))  $('fDate').value  = o.fDate;
        if (o.fPoste && $('fPoste')) $('fPoste').value = o.fPoste;
        refreshPrevSheetButton();
    } catch (e) { }
}
export function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast glass';
    el.style.border = `1px solid ${TOAST_COLORS[type] || TOAST_COLORS.info}`;
    el.innerHTML = `<i data-lucide="${TOAST_ICONS[type] || 'info'}"></i><span>${msg}</span>`;
    $('toasts').appendChild(el);
    if (window.lucide) lucide.createIcons();

    const kill = () => { el.classList.add('bye'); setTimeout(() => el.remove(), 350); };
    setTimeout(kill, type === 'error' ? 3000 : 2000);   // shorter

    /* 3 max — older ones die silently */
    const all = $('toasts').children;
    while (all.length > 3) all[0].remove();
}

/* ------------------------------------------------------------------ */
/*  Pastilles d'état                                                   */
/* ------------------------------------------------------------------ */
export function refreshStatus() {
    $('chipGenDot').className = 'dotline ' + (S.genOn ? 'led-on' : 'led-off');
    $('chipGen').textContent = 'GEN · ' + (S.genOn ? 'ON' : 'OFF');
    $('chipU').textContent = 'U = ' + fr(S.genOn ? S.setV : 0) + ' V';
    $('chipMontage').textContent = 'Montage : ' + (S.montage === '—' ? '—' : S.montage.toUpperCase());
    $('chipRv').textContent = S.Rv + ' Ω';
    $('chipVg').textContent = fr(S.Vg * 1000, 1) + ' mV';
    const bal = $('chipBalDot');
    bal.style.background = S.balanced ? '#34d399' : '#64748b';
    bal.style.boxShadow = S.balanced ? '0 0 8px #34d399' : 'none';
    $('chipBal').textContent = S.balanced ? 'Équilibré' : 'Équilibre';
    $('chipRowA').classList.toggle('hidden', S.level !== 'A');
    $('chipRowB').classList.toggle('hidden', S.level !== 'B');
}

export function setTargetChip(text) {
    const el = $('chipTarget');
    if (el && el.textContent !== text) el.textContent = text;
}

//** Adapte le HUD au mode choisi : solo = ni réseau, ni amis, ni chat. */
export function applySoloUI(solo) {
    ['chipNet', 'chipPlayers'].forEach(id => { const e = $(id); if (e) e.classList.toggle('hidden', !!solo); });
    const chat = $('btnChat'); if (chat) chat.classList.toggle('hidden', !!solo);
    const badge = document.querySelector('#start .badge');
    if (badge) badge.textContent = solo
        ? 'TP Virtuel · Physique · Mode solo (sans personnage)'
        : 'TP Virtuel · Physique · Multijoueur local';
}

export function refreshNetChip() {
    const dot = $('chipNetDot'), txt = $('chipNetTxt');
    if (!dot) return;
    if (ME.online) {
        dot.className = 'dotline ' + (ME.transport === 'ws' ? 'led-on' : 'led-warn');
        txt.textContent = (ME.transport === 'ws' ? 'EN LIGNE' : 'SECOURS') + ' · ' + ME.room;
    } else {
        dot.className = 'dotline led-off';
        txt.textContent = 'SOLO';
    }
}

export function refreshPlayersChip(n) {
    const el = $('chipPlayersTxt');
    if (el) el.textContent = String(Math.max(1, n));
}

/* ------------------------------------------------------------------ */
/*  Objectifs du TP                                                    */
/* ------------------------------------------------------------------ */
const prevDone = { A: new Set(), B: new Set() };
export function refreshMissions() {
    const list = missionsDef[S.level];
    $('missionList').innerHTML = list.map(m => {
        const done = m.test();
        if (done && !prevDone[S.level].has(m.id)) {
            prevDone[S.level].add(m.id);
            sfx.ok(); toast('Objectif validé ✓', 'success');
        }
        return `<div class="mission ${done ? 'done' : ''}">
      <i data-lucide="${done ? 'check-circle-2' : 'circle'}" class="${done ? 'text-done' : ''}"
         style="color:${done ? '#34d399' : '#64748b'}"></i>
      <span class="txt">${m.t}</span></div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

/* ------------------------------------------------------------------ */
/*  FEUILLE DE RELEVÉS — saisie MANUELLE                               */
/* ------------------------------------------------------------------ */
export const rows = [];
export let paperOpen = false;
let onPaperClose = null, onPaperOpen = null;

const FIELDS = ['lvl', 'montage', 'U', 'I', 'R', 'time', 'obs'];

export function setPaperHooks(open, close) { onPaperOpen = open; onPaperClose = close; }

export function refreshLiveLine() {
    const el = $('liveVals');
    if (!el) return;
    if (S.level === 'A') {
        const r = (S.loopOk && Math.abs(S.IA) > 1e-9) ? fr(S.UV / S.IA, 2) + ' Ω' : '<span class="warn">— (circuit incomplet)</span>';
        el.innerHTML =
            `Niveau A · Loi d'Ohm — montage : <b>${S.montage === '—' ? 'non détecté' : S.montage.toUpperCase()}</b> &nbsp;·&nbsp; `
            + `U = <b>${fr(S.UV)} V</b> &nbsp;·&nbsp; I = <b>${fr(S.IA * 1000, 1)} mA</b> &nbsp;·&nbsp; R = U/I = <b>${r}</b>`
            + (S.genOn ? '' : ' &nbsp;·&nbsp; <span class="warn">générateur éteint</span>');
    } else {
        el.innerHTML =
            `Niveau B · Pont de Wheatstone — R1 = R2 = <b>1000 Ω</b> &nbsp;·&nbsp; Rv = <b>${S.Rv} Ω</b> &nbsp;·&nbsp; `
            + `Vg = <b>${fr(S.Vg * 1000, 1)} mV</b> &nbsp;·&nbsp; Rx = <b>${S.balanced ? S.Rv + ' Ω (pont équilibré)' : '? — équilibrez le pont'}</b>`
            + (S.genOn ? '' : ' &nbsp;·&nbsp; <span class="warn">générateur éteint</span>');
    }
}

function cell(r, i, f, ph, size) {
    return `<td><input class="cellin" data-i="${i}" data-f="${f}" value="${String(r[f] ?? '').replace(/"/g, '&quot;')}"
             placeholder="${ph}" ${size ? `style="max-width:${size}px"` : ''} autocomplete="off"></td>`;
}
// persist header fields whenever they change
['fName', 'fDate', 'fPoste'].forEach(id => {
    const el = $(id);
    if (el && !el.dataset.persist) {
        el.dataset.persist = '1';
        el.addEventListener('input', savePaperState);
        el.addEventListener('change', savePaperState);
    }
});

export function renderTable() {
    const body = $('cahierBody');
    if (!body) return;
    $('cahierEmpty').style.display = rows.length ? 'none' : 'block';
    body.innerHTML = rows.map((r, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      ${cell(r, i, 'lvl', 'A / B', 54)}
      ${cell(r, i, 'montage', 'amont…')}
      ${cell(r, i, 'U', '0,00')}
      ${cell(r, i, 'I', '0,0')}
      ${cell(r, i, 'R', '0,00')}
      ${cell(r, i, 'time', '14:05', 62)}
      ${cell(r, i, 'obs', 'remarque…')}
      <td><button class="rowdel" data-i="${i}" title="Effacer la ligne"><i data-lucide="trash-2"></i></button></td>
    </tr>`).join('');
    if (window.lucide) lucide.createIcons();

    body.querySelectorAll('.cellin').forEach(inp => {
        inp.addEventListener('input', () => {
            const r = rows[+inp.dataset.i];
            if (!r) return;
            r[inp.dataset.f] = inp.value;
            if (inp.dataset.f === 'U' || inp.dataset.f === 'I') autoR(r, inp);
            markRecorded(r);
            savePaperState();
        });
        inp.addEventListener('focus', () => sfx.scribble());
    });
    body.querySelectorAll('.rowdel').forEach(b => {
        b.onclick = () => { rows.splice(+b.dataset.i, 1); sfx.click(); renderTable(); savePaperState(); };
    });
}

/** Calcule R = U/I dès que l'élève a écrit U et I (gain de temps, modifiable). */
function autoR(r, inp) {
    const u = parseFloat(String(r.U).replace(',', '.'));
    const i = parseFloat(String(r.I).replace(',', '.'));
    if (Number.isFinite(u) && Number.isFinite(i) && Math.abs(i) > 1e-9) {
        const row = inp.closest('tr');
        const rIn = row.querySelector('[data-f="R"]');
        if (rIn && !rIn.value.trim()) {
            rIn.value = (u / i).toFixed(2).replace('.', ',');
            r.R = rIn.value;
            rIn.animate([{ background: 'rgba(110,231,183,.5)' }, { background: 'transparent' }], { duration: 700 });
        }
    }
}

function markRecorded(r) {
    const filled = ['U', 'I', 'R', 'montage'].filter(f => String(r[f] || '').trim()).length;
    const lvl = String(r.lvl || '').trim().toUpperCase();
    if (filled >= 2) {
        if (lvl.startsWith('B') || S.level === 'B') S.recordedB = true;
        else S.recordedA = true;
        refreshMissions();
    }
}

export function addBlankRow(focus = true) {
    const now = new Date();
    rows.push({
        lvl: '', montage: '', U: '', I: '', R: '', obs: '',
        time: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    });
    sfx.scribble();
    renderTable();
    savePaperState();
    if (focus) {
        const inputs = $('cahierBody').querySelectorAll(`[data-i="${rows.length - 1}"]`);
        if (inputs[1]) inputs[1].focus();
    }
}

/** Recopie ce qu'affichent les appareils dans une nouvelle ligne… à corriger à la main. */
export function addReadingFromInstruments() {
    if (S.level === 'A') {
        if (!S.genOn) { sfx.err(); toast("Générateur éteint : allumez-le avant de relever.", 'error'); return; }
        if (S.montage === '—' || !S.loopOk) { sfx.err(); toast('Circuit incomplet : câblez le montage avant de relever.', 'error'); return; }
        rows.push({
            lvl: 'A', montage: S.montage.toUpperCase(), U: fr(S.UV), I: fr(S.IA * 1000, 1),
            R: fr(S.UV / S.IA, 2), time: nowHM(), obs: '', _auto: true
        });
        S.recordedA = true;
        toast(`Valeurs recopiées : U = ${fr(S.UV)} V, I = ${fr(S.IA * 1000, 1)} mA — vérifiez-les au stylo.`, 'success');
    } else {
        if (!S.genOn) { sfx.err(); toast("Générateur éteint : allumez-le avant de relever.", 'error'); return; }
        if (!S.balanced) { sfx.err(); toast("Le pont n'est pas équilibré : ajustez la boîte à décades.", 'error'); return; }
        rows.push({
            lvl: 'B', montage: 'Wheatstone équilibré', U: fr(S.setV), I: '—',
            R: S.Rv + ' (= Rx)', time: nowHM(), obs: 'R1 = R2 = 1000 Ω', _auto: true
        });
        S.recordedB = true;
        toast(`Valeurs recopiées : Rv = ${S.Rv} Ω ⇒ Rx = ${S.Rv} Ω.`, 'success');
    }
    sfx.ok(); renderTable(); refreshMissions(); savePaperState();
}
const nowHM = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Ouvre / referme la feuille de relevés. */
export function openPaper(o) {
    paperOpen = o;
    $('cahier').classList.toggle('hiddenx', !o);
    if (o) {
        refreshLiveLine(); renderTable();
        if (!$('fName').value) $('fName').value = ME.solo ? '' : (ME.name || '');
        onPaperOpen && onPaperOpen();
    } else {
        onPaperClose && onPaperClose();
        savePaperState();
    }
    updateHintVisibility && updateHintVisibility();
}

/**
 * Clic sur le papier (ou le stylo) : on prend une NOUVELLE feuille vierge.
 * Les relevés déjà écrits restent consultables via « Feuille précédente ».
 */
export function newSheet() {
    const had = rows.length;
    if (had) sheets.push(rows.splice(0, rows.length));
    ['fDate', 'fPoste'].forEach(id => { const e = $(id); if (e) e.value = ''; });
    const d = $('fDate'); if (d) d.value = new Date().toLocaleDateString('fr-FR');
    openPaper(true);
    const sheet = $('cahier');
    if (sheet) { sheet.classList.remove('turn'); void sheet.offsetWidth; sheet.classList.add('turn'); }
    toast(had
        ? `Nouvelle feuille vierge — les ${had} relevé(s) précédent(s) sont conservés (bouton « Feuille précédente »).`
        : 'Nouvelle feuille : remplissez les cases au stylo.', 'info');
    refreshPrevSheetButton();
    savePaperState();
}

/** Pile des feuilles déjà utilisées. */
export const sheets = [];

/** Revient à la feuille précédente (si l'actuelle est vierge, elle est jetée). */
export function prevSheet() {
    if (!sheets.length) { sfx.err(); toast('Aucune feuille précédente.', 'warn'); return; }
    const cur = rows.splice(0, rows.length);
    if (cur.some(r => ['U', 'I', 'R', 'montage', 'obs'].some(f => String(r[f] || '').trim()))) sheets.push(cur);
    rows.push(...sheets.pop());
    sfx.scribble(); renderTable(); refreshPrevSheetButton(); savePaperState();
    toast('Feuille précédente rechargée.', 'info');
}

export function refreshPrevSheetButton() {
    const b = $('btnPrevSheet');
    if (!b) return;
    b.classList.toggle('hidden', sheets.length === 0);
    b.title = sheets.length ? `Revenir à la feuille précédente (${sheets.length} en réserve)` : '';
}

export function exportCSV() {
    if (!rows.length) { toast('La feuille est vierge.', 'warn'); return; }
    const head = 'N°;Nom;Niveau;Montage / Pont;U (V);I (mA);R / Rx (Ω);Heure;Observations\n';
    const name = ($('fName').value || ME.name || '').replace(/;/g, ',');
    const body = rows.map((r, i) => [
        i + 1, name, r.lvl || '', r.montage || '', r.U || '', r.I || '', r.R || '', r.time || '', (r.obs || '').replace(/\n/g, ' ')
    ].join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + head + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'releves_laboratoire_TP.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Export CSV téléchargé.', 'success');
}

/* ------------------------------------------------------------------ */
/*  Chat + coups                                                       */
/* ------------------------------------------------------------------ */
let chatOpen = false, onChatOpen = null, onChatClose = null, onChatSend = null;
export function setChatHooks(open, close, send) { onChatOpen = open; onChatClose = close; onChatSend = send; }
export const isChatOpen = () => chatOpen;
export const isPaperOpen = () => paperOpen;

export function openChat(o) {
    chatOpen = o;
    $('chatbar').classList.toggle('hidden', !o);
    if (o) {
        $('chatInput').value = '';
        onChatOpen && onChatOpen();
        setTimeout(() => $('chatInput').focus(), 30);
    } else {
        onChatClose && onChatClose();
    }
    updateHintVisibility && updateHintVisibility();
}

export function sendChat() {
    const txt = $('chatInput').value.trim();
    openChat(false);
    if (!txt) return;
    if (ME.solo) { toast('Mode solo : il n\'y a personne à qui écrire.', 'info'); return; }
    if (!ME.online) { toast('Aucun serveur : jouez via  python3 server.py  pour discuter à deux.', 'warn'); return; }
    onChatSend && onChatSend(txt);
    sfx.click();
}

export function hurtFlash() {
    const el = $('hurtfx');
    el.classList.add('hit');
    setTimeout(() => el.classList.remove('hit'), 70);
}

/* ------------------------------------------------------------------ */
/*  Visibilité de l'invite « cliquez pour reprendre le contrôle »       */
/* ------------------------------------------------------------------ */
let updateHintVisibility = null;
export function setHintUpdater(fn) { updateHintVisibility = fn; }
