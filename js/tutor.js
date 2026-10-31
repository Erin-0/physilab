/* =====================================================================
   js/tutor.js  —  interface de discussion avec OHMIE (robot tuteur)
   =====================================================================
   • Dock compact en bas à gauche (ne gêne pas la vue) + fenêtre agrandie
     centrée pour relire toute la conversation.
   • La question part au SERVEUR (POST /tutor) : c'est lui qui détient la
     clé Groq, valide, limite et compte les jetons.  Le navigateur n'a
     JAMAIS la clé.
   • Contexte envoyé à chaque question : instantané du banc (appareils,
     calibres, câblage, missions, feuille) + doc du sous-niveau + les 3
     derniers échanges (mémoire courte).
   • La réponse s'affiche : dans le dock, dans la bulle 3D d'Ohmie
     (tronquée, éphémère) et, si la voix est active, à l'oral (fr-FR).
   • Le pourcentage du quota quotidien de jetons est affiché ; rouge au-
     delà de 80 %.
   ===================================================================== */
import { S, ctx, $, VOLT_CALS, AMP_CALS } from './state.js';
import { robotSay, robotMood, robotPointDevice, ROBOT_NAME } from './robot.js';
import { sfx } from './audio.js';

const MAX_CLIENT_MSG = 600;            // même garde-fou que le serveur
const HISTORY_MAX = 3;                // trois derniers échanges seulement
const WORD_RE = /[A-Za-z0-9À-ſ]{2,}/;

let history = [];                     // [{role, content}] — mémoire courte
let pending = false;
let voiceOn = true;
let stats = null;
/**
 * Rendu Markdown léger et sécurisé pour les réponses du tuteur.
 * Prend en charge : **gras**, *italique*, `code inline`, listes à puces, et sauts de ligne.
 */
function renderMarkdown(text) {
    if (!text) return '';
    // 1. Échappement des caractères HTML sensibles
    let out = String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 2. Blocs de code ```code```
    out = out.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // 3. Code inline `code`
    out = out.replace(/`([^`]+)`/g, '<code class="tutor-code">$1</code>');

    // 4. Gras **texte** ou __texte__
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // 5. Italique *texte* ou _texte_
    out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    out = out.replace(/_([^_]+)_/g, '<em>$1</em>');

    // 6. Listes à puces : "- élément" ou "* élément"
    out = out.replace(/(?:^|\n)[ \t]*[-*][ \t]+(.*)/g, '<br>• $1');

    // 7. Sauts de ligne simples
    out = out.replace(/\n/g, '<br>');

    return out;
}
/* ------------------------------------------------------------------ */
/*  Instantané du banc (contexte envoyé au modèle)                    */
/* ------------------------------------------------------------------ */
function wirePairs() {
    return (_wires || []).map(w => [w.a, w.b]);
}
let _wires = null;

function missionsSnapshot() {
    /* états des objectifs du TP courant, sans révéler de théorie */
    const hudMod = hudRef();
    if (!hudMod || !hudMod.missionStates) return [];
    try {
        const key = S.activeTP === 1 ? S.level
            : S.activeTP === 2 ? 'TP2_' + S.tp2Filter
                : 'TP3_' + S.tp3.level;
        const st = hudMod.missionStates(key);
        return (st.states || []).map((ok, i) => ({ ok, t: (st.list[i] || {}).t || ('objectif ' + (i + 1)) }));
    } catch { return []; }
}
let _hud = null;
function hudRef() { return _hud; }

export function buildTutorContext() {
    const t3 = S.tp3 || {};
    const topo = t3.topo || {};
    return {
        tp: S.activeTP,
        niveau: S.activeTP === 1 ? S.level : undefined,
        filtre: S.activeTP === 2 ? S.tp2Filter : undefined,
        manip: S.activeTP === 3 ? t3.level : undefined,
        generateur: S.activeTP === 1 ? { on: S.genOn, consigne_V: S.setV } : undefined,
        multimetres: {
            calibre_V: VOLT_CALS[S.voltCal], calibre_mA: AMP_CALS[S.ammCal],
            aiguille_V_div: ctx.voltPivot ? Math.round(ctx.voltPivot.userData.div * 10) / 10 : null,
            aiguille_mA_div: ctx.ammPivot ? Math.round(ctx.ammPivot.userData.div * 10) / 10 : null,
            surcharge: S.overload
        },
        gbf: S.activeTP === 2 ? { on: S.gbfOn, frequence_Hz: S.gbfFreq, amplitude_Vcc: S.gbfAmp } : undefined,
        oscilloscope: S.activeTP === 2 ? {
            vdiv1: S.osc.ch1VDiv, vdiv2: S.osc.ch2VDiv, tdiv: S.osc.timeDiv,
            sonde_ch1: S.ch1.ok, sonde_ch2: S.ch2.ok
        } : undefined,
        tp3: S.activeTP === 3 ? {
            e1: `E1 ${t3.on1 ? (t3.cc1 ? 'CC ' + (t3.i1 * 1000).toFixed(0) + ' mA' : 'CV ' + t3.E1 + ' V') : 'OFF'}`,
            e2: `E2 ${t3.on2 ? (t3.cc2 ? 'CC ' + (t3.i2 * 1000).toFixed(0) + ' mA' : 'CV ' + t3.E2 + ' V') : 'OFF'}`,
            rheo: t3.rheo,
            topologie: Object.keys(topo).filter(k => topo[k]).join(',') || 'vide'
        } : undefined,
        cablage: wirePairs(),
        missions: missionsSnapshot(),
        feuille: {
            lignes: (hudRef() && hudRef().rows ? hudRef().rows.length : 0),
            cases9: hudRef() && hudRef().measurementsTP3
                ? Object.values(hudRef().measurementsTP3).filter(c => c && c.valeur).length : 0
        }
    };
}

export function tutorDocKey() {
    if (S.activeTP === 1) return S.level === 'B' ? 'tp1_B' : 'tp1_A';
    if (S.activeTP === 2) return S.tp2Filter === 'CR' ? 'tp2_cr'
        : S.tp2Filter === 'RC-CR' ? 'tp2_bande' : 'tp2_rc';
    return 'tp3_' + Math.max(1, Math.min(5, S.tp3.level || 1));
}

/* ------------------------------------------------------------------ */
/*  Garde-fous côté client (feedback immédiat)                        */
/* ------------------------------------------------------------------ */
function clientValidate(msg) {
    const m = String(msg || '').trim();
    if (m.length < 2) return 'Deux caractères minimum : pose-moi une vraie petite question ! ^_^';
    if (m.length > MAX_CLIENT_MSG) return `C'est trop long pour ma petite bulle (${m.length} caractères) : coupe en ${MAX_CLIENT_MSG} max. o_o`;
    if (!WORD_RE.test(m)) return 'Hmm, que des signes bizarres… écris-moi en français ! o_O';
    return null;
}

/* ------------------------------------------------------------------ */
/*  Interface : dock compact + fenêtre agrandie                       */
/* ------------------------------------------------------------------ */
function el(id) { return $(id); }

function pushLine(role, text, isErr = false) {
    for (const bodyId of ['tdBody', 'tmBody']) {
        const body = el(bodyId);
        if (!body) continue;
        const d = document.createElement('div');
        d.className = 'msg ' + (role === 'user' ? 'me' : (isErr ? 'bot err' : 'bot'));

        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = role === 'user' ? 'Toi' : ROBOT_NAME;
        d.appendChild(who);

        // Conteneur de contenu avec support Markdown pour Ohmie, ou texte brut pour l'élève
        const contentSpan = document.createElement('span');
        contentSpan.className = 'msg-content';
        if (role === 'user') {
            contentSpan.textContent = text;
        } else {
            contentSpan.innerHTML = renderMarkdown(text);
        }
        d.appendChild(contentSpan);

        body.appendChild(d);
        body.scrollTop = body.scrollHeight;
    }
}
function renderStats() {
    const e = el('tdStats');
    if (!e) return;
    if (!stats) { e.innerHTML = '<span class="st">Quota : <b>—</b></span>'; e.classList.remove('hot', 'lim'); return; }
    const pt = stats.pct_tokens || 0, pr = stats.pct_requests || 0;
    e.innerHTML =
        `<span class="st">Jetons/jour <b>${Math.round(pt)} %</b> (${stats.day_tokens}/${stats.limits.tpd})</span>` +
        `<span class="st">Requêtes/jour <b>${Math.round(pr)} %</b> (${stats.day_requests}/${stats.limits.rpd})</span>`;
    e.classList.toggle('hot', pt >= 80 || pr >= 80);
    e.classList.toggle('lim', !e.classList.contains('hot') && (stats.min_requests >= stats.limits.rpm || stats.min_tokens >= stats.limits.tpm));
}

async function fetchStats() {
    try {
        const r = await fetch('/tutor/stats');
        const j = await r.json();
        if (j && j.ok) { stats = j; renderStats(); }
    } catch { /* silencieux : le tuteur reste muet, pas le jeu */ }
}

function speak(text) {
    if (!voiceOn || !('speechSynthesis' in window)) return;
    try {
        window.speechSynthesis.cancel();
        const u = new window.SpeechSynthesisUtterance(String(text).slice(0, 420));
        u.lang = 'fr-FR'; u.rate = 1.06; u.pitch = 1.25; u.volume = .9;
        const v = window.speechSynthesis.getVoices().find(v => (v.lang || '').startsWith('fr'));
        if (v) u.voice = v;
        window.speechSynthesis.speak(u);
    } catch { /* tant pis pour la voix */ }
}

/* ------------------------------------------------------------------ */
/*  Envoi d'une question                                              */
/* ------------------------------------------------------------------ */
export async function tutorAsk(raw) {
    if (pending) return;
    const msg = String(raw || '').trim();
    const bad = clientValidate(msg);
    if (bad) { pushLine('oh', bad); robotSay(bad); robotMood('o_O'); return; }

    pending = true;
    const send = el('tdSend');
    if (send) send.disabled = true;
    pushLine('user', msg);
    robotMood('o_O', 1800);
    const td = el('tdBody');
    const typing = td ? document.createElement('div') : null;
    if (typing) { typing.className = 'typing'; typing.textContent = ROBOT_NAME + ' réfléchit …'; td.appendChild(typing); td.scrollTop = td.scrollHeight; }

    let reply = null, err = null;
    try {
        const r = await fetch('/tutor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: msg,
                doc: tutorDocKey(),
                ctx: buildTutorContext(),
                history
            })
        });
        const j = await r.json().catch(() => null);
        if (j && j.ok && typeof j.reply === 'string') {
            reply = j.reply;
            if (j.stats) { stats = j.stats; renderStats(); }
        } else {
            err = (j && j.e) || 'Oups ! Je n\'ai pas réussi à répondre. Réessaie dans un instant. >_<';
            if (j && j.stats) { stats = j.stats; renderStats(); }
        }
    } catch {
        err = 'Oups ! Le lien entre nous a grésillé : vérifie que le serveur tourne, puis repose-moi la question. >_<';
    }

    pending = false;
    if (send) send.disabled = false;
    if (typing && typing.parentNode) typing.parentNode.removeChild(typing);

    if (reply) {
        pushLine('oh', reply);
        robotSay(reply);
        robotMood('^o^', 3200);
        robotPointDevice(reply, msg); // ← نمرر سؤال التلميذ (msg) مع الإجابة (reply)
        speak(reply);
        history.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
        while (history.length > HISTORY_MAX * 2) history.shift();
        sfx.ok && sfx.ok();
    } else {
        pushLine('oh', err, true);
        robotSay(err);
        robotMood('>_<', 3200);
        sfx.err && sfx.err();
    }
    const inp = el('tdInput');
    if (inp) { inp.value = ''; inp.focus(); }
}

/* ------------------------------------------------------------------ */
/*  Ouverture / fermeture                                             */
/* ------------------------------------------------------------------ */
export function tutorToggle(force) {
    const dock = el('tutorDock'), fab = el('tutorFab');
    if (!dock) return;
    const show = force !== undefined ? force : dock.classList.contains('hiddenx');
    dock.classList.toggle('hiddenx', !show);
    if (fab) fab.classList.toggle('hiddenx', show);
    if (show) {
        fetchStats();
        const inp = el('tdInput');
        if (inp) inp.focus();
        if (!dock.dataset.hello) {
            dock.dataset.hello = '1';
            const hello = `Bonjour ! Moi c'est ${ROBOT_NAME}, ton robot tuteur. ^_^ `
                + 'Pose-moi une question sur le banc, le câblage ou la méthode — '
                + 'je guide, mais je ne fais pas les mesures à ta place !';
            pushLine('oh', hello);
            robotSay(hello);
        }
    }
}

export function tutorModal(open) {
    const m = el('tutorModal');
    if (!m) return;
    m.classList.toggle('hiddenx', !open);
    if (open) { const b = el('tmBody'); if (b) b.scrollTop = b.scrollHeight; }
}

export const isTutorTypingTarget = () => {
    const a = document.activeElement;
    return !!a && (a.id === 'tdInput');
};

/** Branchement DOM + références croisées (appelé une fois par main.js). */
export function initTutor(hudMod, wiresArray) {
    _hud = hudMod; _wires = wiresArray;
    const send = () => tutorAsk(el('tdInput') ? el('tdInput').value : '');
    const on = (id, ev, fn) => { const e = el(id); if (e) e.addEventListener(ev, fn); };
    on('tutorFab', 'click', () => { sfx.click(); tutorToggle(true); });
    on('tdClose', 'click', () => { sfx.click(); tutorToggle(false); });
    on('tdExpand', 'click', () => { sfx.click(); tutorModal(true); });
    on('tmClose', 'click', () => { sfx.click(); tutorModal(false); });
    on('tdSend', 'click', send);
    on('tdInput', 'keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
    on('tdVoice', 'click', () => {
        voiceOn = !voiceOn;
        const b = el('tdVoice');
        if (b) b.textContent = voiceOn ? '🔊' : '🔇';
        if (!voiceOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
        sfx.click();
    });
    fetchStats();
}
