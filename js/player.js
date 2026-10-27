/* =====================================================================
   js/player.js  —  contrôleur première personne : verrouillage du
                    pointeur, déplacement (ZQSD + WASD), collisions avec
                    la table ronde et le bureau, loupe (zoom), accroupi,
                    survol / clic des objets, aperçu du fil en cours de
                    pose, et COUPS portés aux autres élèves.
   ===================================================================== */
import * as THREE from 'three';
import {
    S, ctx, ROOM, TABLE_R, DESK, DESK_ROT, EYE_STAND, EYE_CROUCH, ME,
    terminals, allTermIds, wireColor, interactives
} from './state.js';
import { sfx, hum } from './audio.js';
import {
    initPreview, setPreviewVisible, updatePreviewGeometry, previewMat,
    previewTube, previewTip, tipPos, axisVec
} from './wiring.js';
import {
    pressStart, pressEnd, cancelGrab, isDragging, isHolding, draggableFor,
    rotateHeld, setFastSpin, isFastSpin
} from './drag.js';
import { toast, openChat, isChatOpen, isPaperOpen, setTargetChip, hurtFlash } from './hud.js';
import { sendState, sendPunch, sendHit } from './net.js';
import { nearestPeer, hurtPeer, peers as PEERS } from './avatar.js';

/* ------------------------------------------------------------------ */
/*  État du joueur                                                     */
/* ------------------------------------------------------------------ */
export const P = {
    locked: false, started: false,
    hovered: null, hoveredPeer: null,
    pendingTerm: null,
    zoomOn: false, zoomT: 0,
    crouching: false,
    punchAnim: 0, punchCd: 0, hurt: 0,
    bob: 0, speed: 0
};

const FOV_BASE = 60, FOV_ZOOM = 22;
const PUNCH_RANGE = 2.0, PUNCH_CD = .55;

const keys = new Set();
const vel = new THREE.Vector3();
const impulse = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
raycaster.far = 5.5;

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3(), _dir = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
const aimPt = new THREE.Vector3();

let eyeTarget = EYE_STAND;
let hooks = {};

/* collisions : table ronde + bureau (AABB approché, marge du corps incluse) */
const BODY_R = TABLE_R + .2;                    // 1,22 m
const DESK_BOX = (() => {
    const a = DESK_ROT, hw = DESK.w / 2, hd = DESK.d / 2;
    const ex = Math.abs(hw * Math.cos(a)) + Math.abs(hd * Math.sin(a)) + .3;
    const ez = Math.abs(hw * Math.sin(a)) + Math.abs(hd * Math.cos(a)) + .3;
    return { minX: DESK.x - ex, maxX: DESK.x + ex, minZ: DESK.z - ez, maxZ: DESK.z + ez };
})();

/* ------------------------------------------------------------------ */
/*  Initialisation                                                     */
/* ------------------------------------------------------------------ */
export function init(h) {
    hooks = h;
    initPreview(ctx.scene);

    document.addEventListener('pointerlockchange', () => {
        P.locked = document.pointerLockElement === ctx.renderer.domElement;
        if (!P.locked) cancelGrab();
        hooks.updateHint && hooks.updateHint();
    });

    document.addEventListener('mousemove', e => {
        if (!P.locked) return;
        /* la sensibilité suit le champ de vision => visée précise en zoom */
        const sens = .0021 * (ctx.camera.fov / FOV_BASE);
        ctx.yawObj.rotation.y -= e.movementX * sens;
        ctx.pitchObj.rotation.x = Math.max(-1.4, Math.min(1.4, ctx.pitchObj.rotation.x - e.movementY * sens));
    });

    ctx.renderer.domElement.addEventListener('click', () => {
        if (P.started && !P.locked && !isPaperOpen() && !isChatOpen()) lockPointer();
    });
    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('mousedown', e => {
        if (!P.locked) return;
        if (e.button === 0) {
            /* un autre élève sous le viseur ? -> on prépare le coup */
            if (P.hoveredPeer) return;                 // géré au mouseup (clic court)
            pressStart(P.hovered, e);
        } else if (e.button === 2) {
            /* objet en main : le bouton droit MAINTENU passe en rotation rapide */
            if (isDragging()) { setFastSpin(true); return; }
            if (isHolding()) return;                   // appui long en cours : on ne touche à rien
            secondaryAction();
        }
    });

    document.addEventListener('mouseup', e => {
        if (!P.locked) return;
        if (e.button === 2) { if (isFastSpin()) setFastSpin(false); return; }
        if (e.button !== 0) return;
        if (P.hoveredPeer) { tryPunch(P.hoveredPeer); return; }
        const consumed = pressEnd();
        if (consumed) return;
        primaryAction(e.shiftKey);
    });

    document.addEventListener('wheel', e => {
        if (!P.locked) return;
        const d = e.deltaY < 0 ? 1 : -1;
        /* objet saisi : la molette le fait TOURNER sur lui-même */
        if (isDragging()) { rotateHeld(d); e.preventDefault(); return; }
        const u = P.hovered ? P.hovered.userData : null;
        if (u && u.kind === 'knobV') { adjustVoltage(d * .5); e.preventDefault(); return; }
        if (u && u.kind === 'dial') { adjustDial(u.index, d); e.preventDefault(); return; }
        toggleZoom(d > 0);
        e.preventDefault();
    }, { passive: false });

    addEventListener('keydown', e => {
        /* Entrée = chat (jamais de touche dédiée pour la feuille : on clique dessus) */
        if (e.code === 'Enter' && !isChatOpen() && !isPaperOpen()) {
            if (P.started) {
                e.preventDefault();
                if (ME.solo) toast('Mode solo : personne à qui parler — profitez du laboratoire.', 'info');
                else openChat(true);
            }
            return;
        }
        if (isChatOpen() || isPaperOpen()) {
            if (e.code === 'Escape') { e.preventDefault(); hooks.closeOverlays && hooks.closeOverlays(); }
            return;                                    // le clavier appartient au formulaire
        }
        if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'Tab') e.preventDefault();
        if (keys.has(e.code)) return;                  // pas d'auto-répétition pour les bascules
        keys.add(e.code);
        if (!P.started) return;
        if (e.code === 'KeyE' && P.locked) toggleZoom();
        if (e.code === 'Digit1') hooks.setLevel && hooks.setLevel('A');
        if (e.code === 'Digit2') hooks.setLevel && hooks.setLevel('B');
        if (e.code === 'KeyR' && e.shiftKey) hooks.restoreHome && hooks.restoreHome();
        if (e.code === 'Escape') {
            if (isFastSpin()) setFastSpin(false);
            else if (isDragging()) cancelGrab();
        }
    });
    addEventListener('keyup', e => keys.delete(e.code));
    addEventListener('blur', () => keys.clear());
}

export function lockPointer() {
    try {
        const p = ctx.renderer.domElement.requestPointerLock();
        if (p && p.catch) p.catch(() => { });
    } catch (e) { }
}
export const unlockPointer = () => document.exitPointerLock && document.exitPointerLock();

/* ------------------------------------------------------------------ */
/*  Actions                                                            */
/* ------------------------------------------------------------------ */
function primaryAction(shift) {
    if (isDragging()) return;
    if (!P.hovered) { cancelPending(); return; }
    const u = P.hovered.userData;
    switch (u.kind) {
        case 'terminal': clickTerminal(u.id); break;
        case 'switch': toggleGen(); break;
        case 'knobV': adjustVoltage(shift ? -.5 : .5); break;
        case 'dial': adjustDial(u.index, shift ? -1 : 1); break;
        case 'wire': hooks.removeWire && hooks.removeWire(u.wire); break;
        case 'paper':
        case 'pen':
            sfx.scribble();
            hooks.openNewSheet
                ? hooks.openNewSheet()
                : (hooks.openPaper && hooks.openPaper(true));
            break;
    }
}

function secondaryAction() {
    if (P.pendingTerm) { cancelPending(); return; }
    if (!P.hovered) return;
    const u = P.hovered.userData;
    if (u.kind === 'knobV') adjustVoltage(-.5);
    if (u.kind === 'dial') adjustDial(u.index, -1);
}

export function clickTerminal(id) {
    if (!P.pendingTerm) {
        P.pendingTerm = id; sfx.click();
        previewMat.color.setHex(wireColor.current);
        setPreviewVisible(true);
        toast(`Borne source : ${terminals[id].label} — cliquez une borne de destination`, 'info');
    } else if (P.pendingTerm === id) {
        cancelPending();
    } else {
        const a = P.pendingTerm;
        P.pendingTerm = null;
        setPreviewVisible(false);
        hooks.addWire && hooks.addWire(a, id);
    }
}
export function cancelPending() {
    if (P.pendingTerm) { P.pendingTerm = null; setPreviewVisible(false); sfx.click(); }
}

export function toggleGen() {
    S.genOn = !S.genOn;
    sfx.clack(); hum(S.genOn);
    toast(S.genOn
        ? (S.setV === 0 ? 'Générateur sous tension — réglez maintenant la tension U.' : 'Générateur sous tension.')
        : 'Générateur hors tension.', 'info');
    hooks.evaluate && hooks.evaluate();
}

export function adjustVoltage(d) {
    if (!S.genOn) {
        sfx.err();
        toast("Le générateur est éteint : basculez d'abord l'interrupteur M/A.", 'warn');
        return;
    }
    const nv = Math.max(0, Math.min(15, Math.round((S.setV + d) * 2) / 2));
    if (nv === S.setV) { sfx.err(); return; }
    S.setV = nv; sfx.ratchet(); hooks.evaluate && hooks.evaluate();
}

export function adjustDial(i, d) {
    S.digits[i] = (S.digits[i] + d + 10) % 10;
    S.Rv = S.digits[0] * 1000 + S.digits[1] * 100 + S.digits[2] * 10 + S.digits[3];
    sfx.ratchet(); hooks.evaluate && hooks.evaluate();
}

export function toggleZoom(force) {
    P.zoomOn = (force === undefined) ? !P.zoomOn : !!force;
    document.body.classList.toggle('zoomed', P.zoomOn);
    document.getElementById('chipZoom').classList.toggle('hidden', !P.zoomOn);
    sfx.click();
}

/* ---- coups entre élèves ---- */
function tryPunch(target) {
    if (P.punchCd > 0) return;
    const me = ctx.yawObj.position;
    const d = Math.hypot(target.group.position.x - me.x, target.group.position.z - me.z);
    if (d > PUNCH_RANGE) {
        toast(`${target.name} est trop loin — rapprochez-vous (2 m maximum).`, 'warn');
        return;
    }
    P.punchCd = PUNCH_CD;
    P.punchAnim = 1;
    sfx.punch();
    const dx = (target.group.position.x - me.x) / (d || 1);
    const dz = (target.group.position.z - me.z) / (d || 1);
    sendPunch();
    sendHit(target.id, 3.6, dx, dz);
    toast(`Vous avez tapé ${target.name} !`, 'info');
}

export function applyHit(force, dx, dz, fromName) {
    impulse.x += dx * force;
    impulse.z += dz * force;
    P.hurt = 1;
    hurtPeer(ME.id, 1);
    hurtFlash();
    toast(`${fromName} vous a frappé !`, 'error');
}

/* ------------------------------------------------------------------ */
/*  Survol (raycast) : objets + autres élèves                          */
/* ------------------------------------------------------------------ */
const tipEl = () => document.getElementById('tooltip');
const avatarGroups = [];

function updateHover() {
    if (!P.locked) { setHovered(null); setHoveredPeer(null); return; }
    raycaster.setFromCamera({ x: 0, y: 0 }, ctx.camera);
    raycaster.far = 5.5 + 3.0 * P.zoomT;

    /* ---- appareils, bornes, fils, papier, stylo ---- */
    const pool = interactives.filter(o => o.visible !== false && visibleInTree(o));
    const hits = raycaster.intersectObjects(pool, true);
    let first = null, firstDist = 0, firstNonWire = null, nwDist = 0;
    for (const h of hits) {
        if (h.object.userData && (h.object.userData.ignore || h.object.userData.ignorePick)) continue;
        let o = h.object;
        while (o && !(o.userData && o.userData.interact)) o = o.parent;
        if (!o) continue;
        if (!first) { first = o; firstDist = h.distance; }
        if (o.userData.kind !== 'wire') { firstNonWire = o; nwDist = h.distance; break; }
    }
    /* un appareil juste derrière un fil reste accessible (le fil se retire par son milieu) */
    const target = (first && first.userData.kind === 'wire' && firstNonWire && nwDist < firstDist + .5)
        ? firstNonWire : first;
    setHovered(target);

    /* ---- autres élèves (pour les coups) ---- */
    avatarGroups.length = 0;
    for (const a of PEERS.values()) if (a.id !== ME.id && a.group.visible) avatarGroups.push(a.group);
    let peerHit = null;
    if (avatarGroups.length) {
        const ph = raycaster.intersectObjects(avatarGroups, true);
        if (ph.length && ph[0].distance < PUNCH_RANGE + .6) {
            let o = ph[0].object;
            while (o && !o.userData.__peerId) o = o.parent;
            peerHit = o ? PEERS.get(o.userData.__peerId) : null;
        }
    }
    setHoveredPeer(peerHit);
}

function visibleInTree(o) { while (o) { if (o.visible === false) return false; o = o.parent; } return true; }

function setHovered(t) {
    if (t === P.hovered) return;
    P.hovered = t;
    const ch = document.getElementById('crosshair');
    ch.classList.remove('on', 'ctrl', 'grab');
    if (!t) { tipEl().classList.remove('show'); setTargetChip('—'); return; }
    const u = t.userData;
    ch.classList.add(u.kind === 'terminal' || u.kind === 'wire' ? 'on' : 'ctrl');
    if (u.kind === 'device' || u.kind === 'paper' || u.kind === 'pen') ch.classList.add('grab');
    if (isDragging()) ch.classList.add('grab');
    tipEl().querySelector('span').textContent = u.tip || '';
    tipEl().classList.remove('show'); void tipEl().offsetWidth; tipEl().classList.add('show');
    setTargetChip(u.deviceLabel || (u.label ? 'Borne ' + u.label : u.kind === 'wire' ? 'Fil' : u.kind === 'paper' ? 'Feuille de relevés' : u.kind === 'pen' ? 'Stylo' : '—'));
}

function setHoveredPeer(a) {
    if (a === P.hoveredPeer) return;
    P.hoveredPeer = a;
    const el = tipEl();
    if (a) {
        document.getElementById('crosshair').classList.add('on');
        el.querySelector('span').textContent = `${a.name} — clic gauche : lui donner un coup (portée 2 m)`;
        el.classList.add('show');
        setTargetChip(a.name);
    } else if (!P.hovered) {
        el.classList.remove('show');
        setTargetChip('—');
    }
}

/* ------------------------------------------------------------------ */
/*  Déplacement + collisions                                           */
/* ------------------------------------------------------------------ */
function movePlayer(dt) {
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    P.crouching = keys.has('ControlLeft') || keys.has('ControlRight');
    eyeTarget = P.crouching ? EYE_CROUCH : EYE_STAND;
    const speed = (sprint ? 3.4 : 2.0) * (P.zoomOn ? .4 : 1) * (P.crouching ? .6 : 1) * (isDragging() ? .45 : 1);

    const fwd = ((keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp')) ? 1 : 0)
        - ((keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0);
    const str = ((keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0)
        - ((keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft')) ? 1 : 0);

    ctx.camera.getWorldDirection(_v1); _v1.y = 0; _v1.normalize();
    _v2.crossVectors(_v1, UP).normalize();
    _v3.set(0, 0, 0).addScaledVector(_v1, fwd).addScaledVector(_v2, str);
    if (_v3.lengthSq() > 0) _v3.normalize().multiplyScalar(speed);
    vel.lerp(_v3, 1 - Math.pow(.0001, dt));

    /* recul des coups (impulsion amortie) */
    impulse.multiplyScalar(Math.pow(.02, dt));
    if (impulse.lengthSq() < 1e-5) impulse.set(0, 0, 0);

    const p = ctx.yawObj.position;
    p.x += (vel.x + impulse.x) * dt;
    p.z += (vel.z + impulse.z) * dt;
    P.speed = Math.hypot(vel.x + impulse.x, vel.z + impulse.z);
    P.bob += P.speed * dt * 2.4;

    /* ---- collision : paillasse circulaire ---- */
    const r = Math.hypot(p.x, p.z);
    if (r < BODY_R && r > 1e-5) {
        const k = BODY_R / r;
        p.x *= k; p.z *= k;
    } else if (r <= 1e-5) {
        p.z = BODY_R;
    }
    /* ---- collision : bureau des relevés ---- */
    if (p.x > DESK_BOX.minX && p.x < DESK_BOX.maxX && p.z > DESK_BOX.minZ && p.z < DESK_BOX.maxZ) {
        const dxl = p.x - DESK_BOX.minX, dxr = DESK_BOX.maxX - p.x;
        const dzl = p.z - DESK_BOX.minZ, dzr = DESK_BOX.maxZ - p.z;
        const m = Math.min(dxl, dxr, dzl, dzr);
        if (m === dxl) p.x = DESK_BOX.minX;
        else if (m === dxr) p.x = DESK_BOX.maxX;
        else if (m === dzl) p.z = DESK_BOX.minZ;
        else p.z = DESK_BOX.maxZ;
    }
    /* ---- murs ---- */
    const lim = ROOM - .38;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
    /* ---- hauteur d'yeux (accroupi debout en douceur) ---- */
    p.y += (eyeTarget - p.y) * Math.min(1, dt * 9);
}

/* ------------------------------------------------------------------ */
/*  Boucle joueur                                                      */
/* ------------------------------------------------------------------ */
export function update(dt, t) {
    if (P.locked && !isPaperOpen()) movePlayer(dt);

    /* ---- loupe : FOV + léger dolly ---- */
    const zTarget = P.zoomOn ? 1 : 0;
    if (Math.abs(P.zoomT - zTarget) > 1e-4) {
        P.zoomT += (zTarget - P.zoomT) * Math.min(1, dt * 7);
        const e = P.zoomT * P.zoomT * (3 - 2 * P.zoomT);
        ctx.camera.fov = FOV_BASE + (FOV_ZOOM - FOV_BASE) * e;
        ctx.camera.position.z = -.22 * e;
        ctx.camera.updateProjectionMatrix();
    }

    updateHover();

    /* ---- aperçu du fil en cours de pose ---- */
    if (P.pendingTerm) {
        if (P.hovered && P.hovered.userData.kind === 'terminal' && P.hovered.userData.id !== P.pendingTerm) {
            tipPos(P.hovered.userData.id, aimPt);
            axisVec(P.hovered.userData.id, _v4);
            previewMat.opacity = .85;
        } else {
            raycaster.setFromCamera({ x: 0, y: 0 }, ctx.camera);
            raycaster.far = 8;
            const hits = raycaster.intersectObjects(ctx.scene.children, true);
            let pt = null;
            for (const h of hits) {
                if (h.object === previewTube || h.object === previewTip) continue;
                if (h.object.userData && h.object.userData.ignorePick) continue;
                if (h.object.isPoints) continue;
                if (h.distance < .12) continue;
                pt = h.point; break;
            }
            if (pt) aimPt.copy(pt);
            else { raycaster.ray.at(1.1, aimPt); }
            _v4.set(0, 1, 0);
            previewMat.opacity = .5;
        }
        updatePreviewGeometry(P.pendingTerm, aimPt, _v4);
    }

    /* ---- halo des bornes ---- */
    for (const id of allTermIds) {
        const m = terminals[id].ringMat;
        const isHover = P.hovered && P.hovered.userData.id === id;
        m.emissiveIntensity = id === P.pendingTerm ? .55 + .45 * Math.sin(t * 7) : (isHover ? .85 : .18);
    }

    /* ---- animations de combat ---- */
    P.punchCd = Math.max(0, P.punchCd - dt);
    P.punchAnim = Math.max(0, P.punchAnim - dt * 3.2);
    P.hurt = Math.max(0, P.hurt - dt * 2);
    /* petit recul de caméra quand on frappe / qu'on est frappé */
    const kick = P.punchAnim * .05 - P.hurt * .04;
    ctx.pitchObj.position.z = kick;
    ctx.pitchObj.rotation.z = P.hurt * .05 * Math.sin(t * 30);

    /* ---- publication réseau ---- */
    if (ME.online) {
        sendState({
            x: ctx.yawObj.position.x, y: ctx.yawObj.position.y, z: ctx.yawObj.position.z,
            yaw: ctx.yawObj.rotation.y, pitch: ctx.pitchObj.rotation.x,
            crouch: P.crouching, zoom: P.zoomOn, punch: P.punchAnim, bob: P.bob
        });
    }
}

export const isLocked = () => P.locked;
export const isStarted = () => P.started;
export function setStarted(v) { P.started = v; }
export const anyKeyDown = () => keys.size;
export { draggableFor };
