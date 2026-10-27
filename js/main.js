/* =====================================================================
   js/main.js  —  orchestrateur : construit la scène, câble les modules
                  entre eux, gère les niveaux A/B, la boucle de rendu et
                  la liaison avec le serveur multijoueur.
   ===================================================================== */
import * as THREE from 'three';

import { S, ctx, $, PALETTE, wireColor, ME, Q, draggables, wires, interactives } from './state.js';
import { initAudio, sfx, hum, tone } from './audio.js';
import {
    initRenderer, buildRoom, buildRoundTable, buildDesk, buildDust, animateDust,
    flipPaper, animatePaper
} from './environment.js';
import { buildInstruments } from './instruments.js';
import { setScene, addWire, removeWire, clearWires, previewMat } from './wiring.js';
import * as circuit from './circuit.js';
import { updateDisplays, animateGalvo } from './displays.js';
import * as drag from './drag.js';
import * as avatar from './avatar.js';
import * as net from './net.js';
import * as player from './player.js';
import {
    toast, refreshStatus, refreshMissions, refreshLiveLine, renderTable, rows,
    openPaper, openChat, sendChat, exportCSV, addBlankRow, addReadingFromInstruments,
    setPaperHooks, setChatHooks, setHintUpdater, refreshNetChip, isPaperOpen, isChatOpen,
    newSheet, prevSheet, refreshPrevSheetButton, applySoloUI,
    savePaperState, loadPaperState
} from './hud.js';
import { drawLCD } from './textures.js';
import { applyQuality, savedQuality, bindQualityButtons } from './quality.js';
import { applyLighting, savedLighting, bindLighting } from './lighting.js';

/* ================================================================== */
/*  1. Scène, décor, appareils                                         */
/* ================================================================== */
initRenderer();
setScene(ctx.scene);
avatar.init(ctx.scene);
buildRoom();
buildRoundTable();
buildDesk((obj, label, termIds, yOff) => {
    obj.userData.interact = true;
    obj.userData.kind = obj.userData.kind || 'device';
    obj.userData.draggable = true;
    draggables.push({
        obj, label, termIds, yOff,
        faceCenter: false,            // la feuille et le stylo gardent l'orientation choisie
        halfW: .12, halfD: .12,       // affinés par environment.js
        lastGood: null                // dernière pose stable (aucune chute possible)
    });
    /* IMPORTANT : ajouter aussi dans interactives pour que le raycast les détecte */
    interactives.push(obj);
    return draggables[draggables.length - 1];
});
buildInstruments();
buildDust();
drag.captureHome();
circuit.init(wires);

/* ================================================================== */
/*  2. Évaluation du circuit (point d'entrée unique)                   */
/* ================================================================== */
function evaluate(suppress = false) {
    const refresh = suppress
        ? () => { updateDisplays(); refreshStatus(); refreshLiveLine(); }
        : () => { updateDisplays(); refreshStatus(); refreshMissions(); refreshLiveLine(); };
    circuit.evaluate(suppress ? () => { } : toast, refresh);
}
ctx.evaluate = () => evaluate(false);
ctx.toast = toast;
ctx.openPaper = openPaper;
ctx.sfx = sfx;

/* ================================================================== */
/*  3. Câblage (hooks du joueur)                                       */
/* ================================================================== */
const H = {
    evaluate: () => evaluate(false),
    addWire: (a, b) => addWire(a, b, () => evaluate(false), toast),
    removeWire: (w) => removeWire(w, false, () => evaluate(false)),
    clearWires: () => { clearWires(false, () => evaluate(false), toast); player.cancelPending(); },
    openPaper: (o) => openPaper(o),
    /* clic sur le papier ou le stylo : on prend une NOUVELLE feuille vierge */
    openNewSheet: () => { flipPaper(); openPaper(true); },   // open, don't wipe
    setLevel: (l) => setLevel(l),
    updateHint: () => updateHint(),
    closeOverlays: () => { if (isChatOpen()) openChat(false); else if (isPaperOpen()) openPaper(false); },
    restoreHome: () => {
        drag.restoreHome();
        toast('Tous les appareils ont été remis à leur place.', 'success');
    }
};
player.init(H);

/* ================================================================== */
/*  4. Niveaux A / B                                                   */
/* ================================================================== */
function setLevel(lvl) {
    if (S.level === lvl) return;
    S.level = lvl;
    clearWires(true, null, null);
    player.cancelPending();
    drag.cancelGrab();
    ctx.levelA.visible = (lvl === 'A');
    ctx.levelB.visible = (lvl === 'B');
    $('tabA').className = 'tab grow tc' + (lvl === 'A' ? ' active' : '');
    $('tabB').className = 'tab grow tc' + (lvl === 'B' ? ' active-b' : '');

    /* rien n'est jamais « déjà prêt » : le générateur repart éteint, à 0 V */
    circuit.resetGeneratorState();
    hum(false);
    sfx.clack();
    toast(lvl === 'A'
        ? "Niveau A — Loi d'Ohm. Le générateur est éteint : allumez-le, puis câblez G → ampèremètre → R."
        : 'Niveau B — Pont de Wheatstone. Générateur éteint : allumez-le, alimentez P+/P−, insérez la boîte à décades.', 'info');
    evaluate();
}
$('tabA').onclick = () => { sfx.click(); setLevel('A'); };
$('tabB').onclick = () => { sfx.click(); setLevel('B'); };

/* ================================================================== */
/*  5. HUD : palette, boutons, feuille de relevés, chat                */
/* ================================================================== */
PALETTE.forEach(([name, hex], i) => {
    const b = document.createElement('div');
    b.className = 'swatch' + (i === 0 ? ' sel' : '');
    b.title = 'Fil ' + name;
    b.style.background = '#' + hex.toString(16).padStart(6, '0');
    b.onclick = () => {
        wireColor.current = hex; sfx.click();
        document.querySelectorAll('#palette .swatch').forEach(s => s.classList.remove('sel'));
        b.classList.add('sel');
        previewColor(hex);
    };
    $('palette').appendChild(b);
});
const previewColor = (hex) => previewMat.color.setHex(hex);

$('btnClear').onclick = () => H.clearWires();
if ($('btnChat')) $('btnChat').onclick = () => openChat(!isChatOpen());
$('btnRow').onclick = () => addBlankRow(true);
$('btnAdd').onclick = addReadingFromInstruments;
$('btnCSV').onclick = exportCSV;
$('btnClearTable').onclick = () => { rows.length = 0; sfx.click(); renderTable(); savePaperState(); };
if ($('btnNewSheet')) $('btnNewSheet').onclick = () => { sfx.click(); newSheet(); };
if ($('btnPrevSheet')) $('btnPrevSheet').onclick = () => { sfx.click(); prevSheet(); };
refreshPrevSheetButton();
$('btnCloseCahier').onclick = () => openPaper(false);
$('btnResume').onclick = () => { openPaper(false); player.lockPointer(); };

/* hooks de focus : la souris doit être libérée pour écrire sur la feuille */
setPaperHooks(
    () => player.unlockPointer(),
    () => { if (player.isStarted() && !isChatOpen()) player.lockPointer(); }
);
setChatHooks(
    () => player.unlockPointer(),
    () => { if (player.isStarted() && !isPaperOpen()) player.lockPointer(); },
    (txt) => { sendChat(txt); avatar.say(ME.id, txt); }
);
if ($('btnSendChat')) $('btnSendChat').onclick = () => sendChat();
if ($('chatInput')) $('chatInput').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.code === 'Enter') { e.preventDefault(); sendChat(); }
    if (e.code === 'Escape') { e.preventDefault(); openChat(false); }
});
setHintUpdater(updateHint);

function updateHint() {
    $('hint').style.opacity = (player.isStarted() && !player.isLocked() && !isPaperOpen() && !isChatOpen()) ? '1' : '0';
    $('crosshair').classList.toggle('off', !player.isLocked());
}

/* ================================================================== */
/*  6. Mode de jeu : FORCE SOLO (Web-Ready)                           */
/* ================================================================== */
net.initIdentity();

/* On force le mode solo définitivement (pas de serveur, pas de personnages) */
ME.solo = true;
avatar.setSolo(true);
applySoloUI(true);
refreshNetChip();

/* Le seul et unique bouton pour entrer dans le laboratoire */
$('btnStart').onclick = () => {
    initAudio();
    player.setStarted(true);
    $('start').classList.add('gone');
    player.lockPointer();
    updateHint();
    setTimeout(() => toast('Générateur éteint : allumez-le, puis câblez G → A → R.', 'info'), 800);
    setTimeout(() => toast('Clic droit maintenu = rotation rapide · clic sur le papier = ouvrir la feuille.', 'info'), 3500);
    evaluate();
};
/* ================================================================== */
/*  7. Qualité graphique                                               */
/* ================================================================== */
bindQualityButtons(sfx.click);
applyQuality(savedQuality(), true);
bindLighting(sfx.click);
savedLighting();
applyLighting(true);

/* ================================================================== */
/*  8. Boucle principale                                               */
/* ================================================================== */
addEventListener('resize', () => {
    ctx.camera.aspect = innerWidth / innerHeight;
    ctx.camera.updateProjectionMatrix();
    ctx.renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, lcdTick = 0, scPhase = -1, beepAt = 0;
const _pos = new THREE.Vector3();

function animate() {
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;

    player.update(dt, t);
    drag.update(dt, ctx.yawObj.rotation.y, ctx.yawObj.position);
    animatePaper(dt);
    animateDust(dt, t);
    animateGalvo(dt);

    /* ---- réseau : avatar local + interpolation des autres (jamais en solo) ---- */
    if (!ME.solo && (ME.online || avatar.peers.size)) {
        ctx.yawObj.getWorldPosition(_pos);
        avatar.setLocalAvatarTransform(ME.id || 'me', _pos, ctx.yawObj.rotation.y,
            player.P.crouching, player.P.punchAnim, player.P.hurt, player.P.bob);
        avatar.update(dt, t, ME.id || 'me');
    }

    /* ---- écran LCD : cadence limitée selon la qualité ---- */
    lcdTick++;
    const lcdEvery = Math.max(1, Math.round(60 / (Q.lcdFps || 30)));
    if (lcdTick % lcdEvery === 0) updateDisplays();

    /* ---- respiration du luminaire (autour de l'intensité choisie) ---- */
    if (ctx.spot) {
        const base = (ctx.lights && ctx.lights.spotBase) || 150;
        ctx.spot.intensity = base + (Math.sin(t * 4.7) * 1.2 + Math.sin(t * 3.1) * 2) * (base / 150);
    }

    /* ---- levier de l'interrupteur ---- */
    if (ctx.switchPivot) {
        ctx.switchPivot.rotation.x += ((S.genOn ? .45 : -.45) - ctx.switchPivot.rotation.x) * Math.min(1, dt * 14);
    }

    /* ---- viseur : état « fil en attente » ---- */
    $('crosshair').classList.toggle('pending', !!player.P.pendingTerm && player.isLocked());

    /* ---- court-circuit : LCD qui clignote ---- */
    if (S.faultShort) {
        const ph = ((t * 2) | 0) % 2;
        if (ph !== scPhase) {
            scPhase = ph;
            if (ctx.genLCD) drawLCD(ctx.genLCD, ph ? ' ' : 'SC !!', 'PROTECTION', '#ff8a7a');
        }
    } else scPhase = -1;

    /* ---- bip périodique en cas de surcharge ---- */
    if (S.overload && t - beepAt > .8) { beepAt = t; tone(980, .07, 'square', .14); }

    /* ---- compteur d'images ---- */
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= .5) {
        $('fps').textContent = Math.round(fpsFrames / fpsAcc) + ' fps';
        fpsAcc = 0; fpsFrames = 0;
    }

    ctx.renderer.render(ctx.scene, ctx.camera);
}
ctx.renderer.setAnimationLoop(animate);

loadPaperState();

/* ================================================================== */
/*  9. Initialisation                                                  */
/* ================================================================== */
if (window.lucide) lucide.createIcons();
updateDisplays();
refreshStatus();
refreshMissions();
refreshLiveLine();
renderTable();
refreshNetChip();
updateHint();
evaluate();
document.fonts && document.fonts.ready.then(() => updateDisplays());

/* Le panneau « raccourcis clavier » a été supprimé : les aides arrivent
   sous forme de toasts au démarrage, et les info-bulles au survol. */
