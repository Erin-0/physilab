/* =====================================================================
   js/instruments.js  —  construction des appareils du TP.

   Cette version a deux exigences :

   1. TAILLE — chaque appareil est dessiné à sa dimension RÉELLE (en
      mètres) puis multiplié par INSTR_SCALE (state.js). Les proportions
      entre les appareils, et entre les appareils et la paillasse, restent
      donc celles d'un vrai laboratoire : on a seulement grossi l'ensemble
      pour que les cadrans soient lisibles.

   2. RÉALISME — les appareils reprennent le matériel qu'on trouve
      réellement sur une paillasse de TP :
        • alimentation stabilisée 0–15 V / 2 A : boîtier métal, poignée de
          transport, pieds caoutchouc, afficheur, bouton « TENSION »,
          interrupteur M/A à voyant, douilles bananes 4 mm rouge/noire ;
        • multimètres numériques autoranging : étui de protection jaune,
          grand afficheur, sélecteur rotatif de fonction, douilles
          COM (noire) et V/Ω/mA (rouge) ;
        • boîte de résistance bobinée : plaque bakélite inclinée, résistance
          de puissance sur barreau céramique, douilles de sortie ;
        • boîte à résistances à décades : boîtier bakélite, TAMBOURS
          CHIFFRÉS mécaniques (pas d'écran), quatre boutons crantés
          ×1000 ×100 ×10 ×1, bornes A / B ;
        • galvanomètre à zéro central : boîtier crème, cadran avec ÉCHELLE
          et MIROIR anti-parallaxe, vitre, aiguille rouge, réglage de zéro ;
        • pont de Wheatstone : circuit imprimé vert, sérigraphie blanche,
          quatre résistances à code de couleurs, réglette en laiton avec
          curseur, douilles laiton.

   Disposition : paillasse CIRCULAIRE au centre, appareils en couronne
   face au centre (il faut en faire le tour pour lire les afficheurs) ;
   seule la carte du pont reste à plat, au milieu.
   ===================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
    TABLE_R, TABLE_H, INSTR_SCALE, terminals, allTermIds, interactives, draggables, ctx
} from './state.js';
import { panelPlane, makeLCD, resistorBandTexture, rr, knurlTexture } from './textures.js';

const K = INSTR_SCALE;                        // facteur d'agrandissement global
const addAt = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };

/* ------------------------------------------------------------------ */
/*  Matériaux récurrents du matériel de laboratoire                    */
/* ------------------------------------------------------------------ */
const MAT = {
    steel:   () => new THREE.MeshStandardMaterial({ color: 0x8d97a8, metalness: .9, roughness: .28 }),
    brass:   () => new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: .85, roughness: .32 }),
    dark:    () => new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: .42, metalness: .45 }),
    bakelite:() => new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: .58, metalness: .08 }),
    rubber:  () => new THREE.MeshStandardMaterial({ color: 0x0f1114, roughness: .95, metalness: 0 }),
    cream:   () => new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: .45, metalness: .05 }),
    yellow:  () => new THREE.MeshStandardMaterial({ color: 0xd9b02a, roughness: .5, metalness: .12 }),
    pcb:     () => new THREE.MeshStandardMaterial({ color: 0x1d5c3a, roughness: .5, metalness: .18 }),
    ceramic: () => new THREE.MeshStandardMaterial({ color: 0xd9d2c2, roughness: .7, metalness: .03 })
};

/* ------------------------------------------------------------------ */
/*  Bornes bananes 4 mm (comme sur tout le matériel de TP)             */
/* ------------------------------------------------------------------ */
export function makeTerminal(id, label, colorHex, axis = 'z', owner = null) {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: .4, metalness: .5 });
    const colored = new THREE.MeshStandardMaterial({
        color: colorHex, emissive: colorHex, emissiveIntensity: .18, metalness: .55, roughness: .3
    });
    let ring, base, post;
    if (axis === 'z') {
        base = new THREE.Mesh(new THREE.CylinderGeometry(.013, .015, .006, 20), dark);
        base.rotation.x = Math.PI / 2; base.position.z = .003;
        ring = new THREE.Mesh(new THREE.CylinderGeometry(.017, .017, .005, 24), colored);
        ring.rotation.x = Math.PI / 2; ring.position.z = .007;
        post = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .012, 14), dark);
        post.rotation.x = Math.PI / 2; post.position.z = .011;
    } else {
        base = new THREE.Mesh(new THREE.CylinderGeometry(.013, .015, .006, 20), dark);
        base.position.y = .003;
        ring = new THREE.Mesh(new THREE.CylinderGeometry(.017, .017, .005, 24), colored);
        ring.position.y = .007;
        post = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .012, 14), dark);
        post.position.y = .012;
    }
    g.add(base, ring, post);
    g.userData = {
        interact: true, kind: 'terminal', id, label,
        tip: `Borne « ${label} » — clic : démarrer / terminer un fil`
    };
    terminals[id] = { group: g, ringMat: colored, axis, id, label, owner };
    allTermIds.push(id);
    interactives.push(g);
    return g;
}

/** Coquille d'appareil (boîtier arrondi). */
export function makeShell(w, h, d, r = 0.012) {
    const body = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r),
        new THREE.MeshStandardMaterial({ color: 0x272c37, metalness: .4, roughness: .48 }));
    body.castShadow = true; body.receiveShadow = true;
    return body;
}

/* ------------------------------------------------------------------ */
/*  Détails réalistes réutilisables                                    */
/* ------------------------------------------------------------------ */
/**
 * Quatre pieds caoutchouc, comme sur un vrai appareil de paillasse.
 * @param bottomY  cote LOCALE du dessous du boîtier (les pieds y sont collés)
 * @param drop     hauteur dont les pieds dépassent sous le boîtier
 * Leur base se retrouve donc à `bottomY - drop` : c'est cette cote qui doit
 * être mesurée par placeDevice() (Box3) pour que l'appareil repose exactement
 * sur le plateau, ni flottant ni enfoncé.
 */
function addFeet(g, w, d, r = .014, bottomY = 0, drop = .012) {
    const m = MAT.rubber();
    const h = drop;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        const f = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, h, 14), m);
        f.position.set(sx * (w / 2 - .05), bottomY - h / 2, sz * (d / 2 - .05));
        f.castShadow = true;
        g.add(f);
    });
}

/** Poignée de transport rabattable (anse + deux supports). */
function addHandle(g, w, topY, backZ, scale = 1) {
    const m = MAT.steel();
    const postG = new THREE.CylinderGeometry(.009 * scale, .009 * scale, .042 * scale, 10);
    [-1, 1].forEach(s => {
        const p = new THREE.Mesh(postG, m);
        p.position.set(s * (w * .31), topY + .02 * scale, backZ);
        p.castShadow = true; g.add(p);
    });
    const grip = new THREE.Mesh(
        new THREE.TorusGeometry(w * .27, .011 * scale, 8, 26, Math.PI), MAT.dark());
    grip.rotation.z = Math.PI;                 // anse ouverte vers le haut
    grip.position.set(0, topY + .041 * scale, backZ);
    grip.castShadow = true;
    g.add(grip);
}

/** Graduations imprimées autour d'un bouton (repères réels du cadran). */
function addTicks(g, cx, cy, cz, rIn, rOut, n = 11, spreadDeg = 270, color = 0x9fb0c8) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85 });
    const geo = new THREE.BoxGeometry(.0035, .0018, .0018);
    for (let i = 0; i < n; i++) {
        const a = (-spreadDeg / 2 + spreadDeg * i / (n - 1)) * Math.PI / 180 + Math.PI / 2;
        const t = new THREE.Mesh(geo, m);
        const rm = (rIn + rOut) / 2;
        t.position.set(cx + Math.cos(a) * rm, cy + Math.sin(a) * rm, cz);
        t.scale.x = (rOut - rIn) / .0035;
        t.rotation.z = a;
        g.add(t);
    }
}

/** Bouton cranté noir avec index blanc (réglage de tension / décades). */
let _knurlTex = null;
function makeKnob(r = .03, depth = .022, pointerColor = 0xf2f5fa, pickable = true) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.12, .012, 30), MAT.dark());
    base.rotation.x = Math.PI / 2;
    /* cannelures : une seule texture cylindrique au lieu de 12 petits maillages */
    if (!_knurlTex) _knurlTex = knurlTexture();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(r * .82, r * .82, depth, 30, 1, true),
        new THREE.MeshStandardMaterial({ map: _knurlTex, roughness: .42, metalness: .5 }));
    grip.rotation.x = Math.PI / 2; grip.position.z = depth / 2 + .004;
    const capTop = new THREE.Mesh(new THREE.CircleGeometry(r * .82, 26),
        new THREE.MeshStandardMaterial({ color: 0x2c3345, roughness: .4, metalness: .5 }));
    capTop.position.z = depth + .004;
    const ptr = new THREE.Mesh(new THREE.BoxGeometry(.0045, r * .7, .004),
        new THREE.MeshStandardMaterial({ color: pointerColor, emissive: 0x6b7280, emissiveIntensity: .25 }));
    ptr.position.set(0, r * .46, depth + .007);
    g.add(base, grip, capTop, ptr);
    if (!pickable) g.traverse(o => { o.userData.ignorePick = true; });
    return g;
}

/* ------------------------------------------------------------------ */
/*  Placement autour de la table ronde, face au centre                 */
/* ------------------------------------------------------------------ */
const DEG = Math.PI / 180;
const RING_R = .66;                 // rayon de la couronne d'appareils
/** angle (degrés, 0 = côté nord/fond de la pièce) -> position sur la table */
function ringPos(angDeg, r = RING_R) {
    const a = angDeg * DEG;
    return { x: r * Math.sin(a), z: -r * Math.cos(a) };
}
/** orientation : la face avant (+Z local) pointe vers le centre de la table */
function faceCenter(x, z) { return Math.atan2(-x, -z); }

/**
 * Enregistre un appareil comme objet déplaçable à l'appui long.
 * @param obj        groupe Three de l'appareil
 * @param label      nom affiché à l'écran
 * @param termIds    bornes portées par l'appareil (débranchées si on le bouge)
 * @param yOff       hauteur du point de référence au-dessus du plateau
 * @param faceIt     true -> orientation INITIALE face au centre (ensuite libre)
 */
function registerDevice(obj, label, termIds, yOff, faceIt = true) {
    obj.userData.interact = true;
    obj.userData.kind = 'device';
    obj.userData.deviceLabel = label;
    obj.userData.draggable = true;
    obj.userData.tip = `${label} — clic : utiliser · appui long : déplacer · molette : tourner`;
    draggables.push({
        obj, label, termIds,
        yOff,
        faceCenter: faceIt,
        halfW: .17, halfD: .13,       // affinés ci-dessous par objet
        lastGood: null, restY: TABLE_H
    });
    interactives.push(obj);
    return draggables[draggables.length - 1];
}

/**
 * Pose un appareil sur la paillasse circulaire, face au centre, à sa taille
 * mise à l'échelle, puis l'enregistre comme objet déplaçable.
 * `w`, `h`, `d` sont les dimensions AUTEUR (taille réelle, en mètres).
 */
const _bbox = new THREE.Box3();

/**
 * Cote locale du point le plus bas d'un appareil (dessous de ses pieds).
 * Mesurée, jamais devinée : l'appareil repose donc toujours exactement sur
 * le plateau, quelle que soit sa géométrie.
 */
function lowestLocalY(g, fallbackH) {
    try {
        g.updateMatrixWorld(true);
        _bbox.setFromObject(g);
        const y = _bbox.min.y;
        if (Number.isFinite(y)) return y;
    } catch (e) { /* repli ci-dessous */ }
    return -fallbackH / 2;
}

function placeDevice(g, { angDeg, w, h, d, label, termIds, faceIt = true }) {
    /* mesure AVANT mise à l'échelle : on travaille en cotes locales réelles */
    const bottom = lowestLocalY(g, h);
    g.scale.setScalar(K);
    const p = ringPos(angDeg);
    const yOff = -bottom * K + .001;           // +1 mm : jeu de pose, invisible à l'œil
    g.position.set(p.x, TABLE_H + yOff, p.z);
    g.rotation.y = faceCenter(p.x, p.z);
    const rec = registerDevice(g, label, termIds, yOff, faceIt);
    rec.halfW = w / 2 * K; rec.halfD = d / 2 * K;
    return rec;
}

/* ================================================================== */
/*  ALIMENTATION STABILISÉE 0–15 V / 2 A  (commune aux deux niveaux)    */
/* ================================================================== */
export function buildGenerator() {
    const genGroup = new THREE.Group();
    const w = .46, h = .2, d = .36;
    genGroup.add(makeShell(w, h, d));

    /* pieds + poignée de transport + aération arrière */
    addFeet(genGroup, w, d, .015, -h / 2, .012);
    addHandle(genGroup, w, h / 2, -d / 2 + .05);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(w * .5, h * .55, .006),
        new THREE.MeshStandardMaterial({ color: 0x191d25, roughness: .8 }));
    vent.position.set(0, 0, -d / 2 - .002); genGroup.add(vent);

    /* ---- face avant sérigraphiée ---- */
    const panel = panelPlane(.44, .19, 512, 224, (ctx2, W, H) => {
        const px = (x) => (x / W - .5) * .44, py = (y) => (.5 - y / H) * .19;
        ctx2.fillStyle = '#171b23'; ctx2.fillRect(0, 0, W, H);
        const g = ctx2.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, 'rgba(255,255,255,.07)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
        ctx2.fillStyle = g; ctx2.fillRect(0, 0, W, H);

        ctx2.fillStyle = '#a8bbd2'; ctx2.font = '600 21px "Space Grotesk",sans-serif'; ctx2.textAlign = 'center';
        ctx2.fillText('ALIMENTATION STABILISÉE', W / 2, 26);
        ctx2.fillStyle = '#61728b'; ctx2.font = '500 14px "Space Grotesk",sans-serif';
        ctx2.fillText('0 – 15 V ⎓   ·   2 A max   ·   TYPE PS-1502', W / 2, 46);

        /* fenêtre de l'afficheur (l'écran 3D vient se poser dessus) */
        ctx2.fillStyle = '#04080b'; rr(ctx2, W / 2 - 96, 55, 192, 66, 8); ctx2.fill();
        ctx2.strokeStyle = 'rgba(125,255,216,.22)'; ctx2.lineWidth = 2;
        rr(ctx2, W / 2 - 96, 55, 192, 66, 8); ctx2.stroke();

        /* sérigraphie autour du bouton de tension */
        ctx2.strokeStyle = '#4d5b72'; ctx2.lineWidth = 2.4;
        ctx2.beginPath(); ctx2.arc(px(-.155) * (W / .44) + W / 2, py(-.055) * (H / .19) + H / 2, 40, 0, 7); ctx2.stroke();
        ctx2.fillStyle = '#8ea2bb'; ctx2.font = '600 15px "Space Grotesk",sans-serif';
        ctx2.fillText('TENSION', W / 2 - 183, 205);
        ctx2.fillStyle = '#ef6461'; ctx2.font = '700 26px "Space Grotesk",sans-serif';
        ctx2.fillText('+', W / 2 + 62, 148);
        ctx2.fillStyle = '#c3cad6'; ctx2.fillText('−', W / 2 - 62, 148);
        ctx2.fillStyle = '#8ea2bb'; ctx2.font = '600 14px "Space Grotesk",sans-serif';
        ctx2.fillText('SORTIE', W / 2, 213);

        /* interrupteur M/A */
        ctx2.fillStyle = '#c3cad6'; ctx2.font = '700 13px "Space Grotesk",sans-serif';
        ctx2.fillText('I', W / 2 + 152, 150); ctx2.fillText('O', W / 2 + 152, 200);
        ctx2.fillStyle = '#5d6d86'; ctx2.font = '600 13px "Space Grotesk",sans-serif';
        ctx2.fillText('M / A', W / 2 + 186, 178);

        ctx2.fillStyle = '#f2a65a'; ctx2.font = '600 13px "Space Grotesk",sans-serif';
        ctx2.fillText('livré hors tension — à allumer par l\'élève', W / 2, 132);

        ctx2.fillStyle = '#0b0d11';
        [[12, 12], [W - 12, 12], [12, H - 12], [W - 12, H - 12]].forEach(([x, y]) => {
            ctx2.beginPath(); ctx2.arc(x, y, 4.5, 0, 7); ctx2.fill();
        });
    });
    panel.mesh.position.z = d / 2 + .001; genGroup.add(panel.mesh);

    /* ---- afficheur ---- */
    const genLCD = makeLCD(256, 84);
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(.186, .072, .008, 3, .003), MAT.dark());
    bezel.position.set(0, .048, d / 2 + .003); genGroup.add(bezel);
    const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(.172, .058),
        new THREE.MeshBasicMaterial({ map: genLCD.tex }));
    lcdMesh.position.set(0, .048, d / 2 + .008); genGroup.add(lcdMesh);

    /* ---- bouton de tension (cranté, graduations imprimées) ---- */
    const voltKnob = makeKnob(.031, .02, 0xffd166);
    addTicks(genGroup, -.155, -.055, d / 2 + .004, .042, .05);
    voltKnob.position.set(-.155, -.055, d / 2 + .004);
    voltKnob.userData = { interact: true, kind: 'knobV', tip: 'Réglage tension — clic : +0,5 V · Maj+clic / molette : réglage fin' };
    genGroup.add(voltKnob); interactives.push(voltKnob);

    /* ---- interrupteur marche/arrêt à bascule ---- */
    const swBase = new THREE.Mesh(new THREE.BoxGeometry(.036, .052, .012), MAT.dark());
    swBase.position.set(.155, -.055, d / 2 + .006);
    const switchPivot = new THREE.Group();
    switchPivot.position.set(.155, -.055, d / 2 + .012);
    const switchLever = new THREE.Mesh(new THREE.BoxGeometry(.015, .038, .017),
        new THREE.MeshStandardMaterial({ color: 0xd7dde8, roughness: .3, metalness: .5 }));
    switchLever.position.y = .015;
    switchPivot.add(switchLever);
    switchPivot.rotation.x = -.45;                                  // position ARRÊT
    swBase.userData = switchPivot.userData = { interact: true, kind: 'switch', tip: 'Interrupteur Marche / Arrêt du générateur' };
    genGroup.add(swBase, switchPivot);
    interactives.push(switchPivot); interactives.push(swBase);

    /* ---- voyant de mise sous tension ---- */
    const genLEDmat = new THREE.MeshStandardMaterial({ color: 0x1d2b23, emissive: 0x27e07c, emissiveIntensity: 0 });
    const ledBezel = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .006, 16), MAT.dark());
    ledBezel.rotation.x = Math.PI / 2; ledBezel.position.set(.2, .078, d / 2 + .001);
    const led = new THREE.Mesh(new THREE.SphereGeometry(.0075, 12, 12), genLEDmat);
    led.position.set(.2, .078, d / 2 + .004);
    genGroup.add(ledBezel, led);

    /* ---- douilles bananes de sortie ---- */
    genGroup.add(addAt(makeTerminal('G+', '+ du générateur', 0xd93a3a, 'z', genGroup), .06, -.062, d / 2));
    genGroup.add(addAt(makeTerminal('G-', '− du générateur', 0x1c1f27, 'z', genGroup), -.06, -.062, d / 2));

    placeDevice(genGroup, {
        angDeg: 180, w, h, d,
        label: 'Générateur 0–15 V', termIds: ['G+', 'G-']
    });
    ctx.genGroup = genGroup; ctx.genLCD = genLCD; ctx.voltKnob = voltKnob;
    ctx.switchPivot = switchPivot; ctx.genLEDmat = genLEDmat;
    return genGroup;
}

/* ================================================================== */
/*  MULTIMÈTRES NUMÉRIQUES (voltmètre / ampèremètre)                   */
/* ================================================================== */
/** Étui de protection jaune façon multimètre de paillasse. */
function addHolster(g, w, h, d, mat) {
    const t = .012, o = .005;
    const W = w + o * 2, H = h + o * 2;
    const side = (x, y, z, sx, sy, sz) => {
        const m = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 2, .004), mat);
        m.position.set(x, y, z); m.castShadow = true; g.add(m);
    };
    /* quatre montants verticaux aux coins */
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
        side(sx * (W / 2 - t / 2), 0, sz * (d / 2 + o - t / 2), t, H, t));
    /* quatre traversées horizontales (haut/bas, avant/arrière) */
    [1, -1].forEach(sy => {
        side(0, sy * (H / 2 - t / 2), d / 2 + o - t / 2, W - t * 2, t, t);
        side(0, sy * (H / 2 - t / 2), -d / 2 - o + t / 2, W - t * 2, t, t);
    });
    [-1, 1].forEach(sx => {
        side(sx * (W / 2 - t / 2), H / 2 - t / 2, 0, t, t, d + o * 2 - t * 2);
        side(sx * (W / 2 - t / 2), -H / 2 + t / 2, 0, t, t, d + o * 2 - t * 2);
    });
    /* pied arrière rabattable (béquille) */
    const stand = new THREE.Mesh(new THREE.BoxGeometry(w * .6, .006, .05), mat);
    stand.position.set(0, -h * .18, -d / 2 - .022);
    stand.rotation.x = -.5; g.add(stand);
}

function makeMeter(title, unit, idPlus, idMinus, labelPlus, lcd) {
    const g = new THREE.Group();
    const w = .25, h = .115, d = .2;
    g.add(makeShell(w, h, d, .014));
    addHolster(g, w, h, d, MAT.yellow());

    const panel = panelPlane(.235, .105, 512, 230, (ctx2, W, H) => {
        ctx2.fillStyle = '#15181f'; ctx2.fillRect(0, 0, W, H);
        const gg = ctx2.createLinearGradient(0, 0, 0, H);
        gg.addColorStop(0, 'rgba(255,255,255,.06)'); gg.addColorStop(1, 'rgba(0,0,0,.16)');
        ctx2.fillStyle = gg; ctx2.fillRect(0, 0, W, H);

        ctx2.fillStyle = '#a8bbd2'; ctx2.font = '600 20px "Space Grotesk",sans-serif'; ctx2.textAlign = 'center';
        ctx2.fillText(title, W / 2, 24);
        ctx2.fillStyle = '#5f7089'; ctx2.font = '500 12px "Space Grotesk",sans-serif';
        ctx2.fillText('multimètre numérique · autoranging', W / 2, 41);

        /* fenêtre d'affichage */
        ctx2.fillStyle = '#04080b'; rr(ctx2, W / 2 - 104, 50, 208, 62, 8); ctx2.fill();
        ctx2.strokeStyle = 'rgba(125,255,216,.22)'; ctx2.lineWidth = 2;
        rr(ctx2, W / 2 - 104, 50, 208, 62, 8); ctx2.stroke();

        /* sélecteur rotatif de fonction + positions sérigraphiées */
        ctx2.strokeStyle = '#4d5b72'; ctx2.lineWidth = 2.2;
        ctx2.beginPath(); ctx2.arc(W / 2, 160, 42, 0, 7); ctx2.stroke();
        ctx2.fillStyle = '#9fb4cc'; ctx2.font = '600 13px "Space Grotesk",sans-serif';
        ['OFF', 'V⎓', 'mA', 'Ω'].forEach((t, i) => {
            const a = (-135 + i * 90) * Math.PI / 180;
            ctx2.fillText(t, W / 2 + Math.sin(a) * 58, 160 - Math.cos(a) * 58 + 5);
        });
        ctx2.fillStyle = '#c3cad6'; ctx2.font = '700 12px "Space Grotesk",sans-serif';
        ctx2.fillText('FONCTION', W / 2, 218);

        /* douilles : COM (noire), V/Ω/mA (rouge), entrée 10 A (décor) */
        ctx2.font = '700 13px "Space Grotesk",sans-serif';
        ctx2.fillStyle = '#c3cad6'; ctx2.fillText('COM', W / 2 - 112, 200);
        ctx2.fillStyle = '#ef6461'; ctx2.fillText(labelPlus, W / 2 + 112, 200);
        ctx2.fillStyle = '#7b8798'; ctx2.font = '600 11px "Space Grotesk",sans-serif';
        ctx2.fillText('10 A max', W / 2 - 168, 200);
        ctx2.strokeStyle = '#39435a'; ctx2.lineWidth = 3;
        ctx2.beginPath(); ctx2.arc(W / 2 - 168, 178, 13, 0, 7); ctx2.stroke();
        ctx2.fillStyle = '#8ea2bb'; ctx2.font = '500 12px "Space Grotesk",sans-serif';
        ctx2.fillText('CAT III 300 V', W / 2, 34);
        ctx2.textAlign = 'left';
        ctx2.fillText(unit, 14, 224);
    });
    panel.mesh.position.z = d / 2 + .001; g.add(panel.mesh);

    /* cadre d'afficheur + écran */
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(.158, .05, .007, 3, .003), MAT.dark());
    bezel.position.set(0, .0195, d / 2 + .003); g.add(bezel);
    const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(.148, .042),
        new THREE.MeshBasicMaterial({ map: lcd.tex }));
    lcdMesh.position.set(0, .0195, d / 2 + .008); g.add(lcdMesh);

    /* sélecteur rotatif (décoratif : l'appareil est autoranging) */
    const sel = makeKnob(.021, .012, 0xe8eef8, false);
    sel.position.set(0, -.0255, d / 2 + .004);
    g.add(sel);
    addTicks(g, 0, -.0255, d / 2 + .003, .027, .033, 9, 270, 0x6f7f97);
    (ctx.meterSel || (ctx.meterSel = [])).push(sel);

    g.add(addAt(makeTerminal(idMinus, 'COM ' + title.toLowerCase(), 0x1c1f27, 'z', g), -.05, -.043, d / 2));
    g.add(addAt(makeTerminal(idPlus, labelPlus + ' ' + title.toLowerCase(), 0xd93a3a, 'z', g), .05, -.043, d / 2));
    g.userData._h = h;
    return g;
}

export function buildMeters(levelA) {
    const voltLCD = makeLCD(256, 76), ammLCD = makeLCD(256, 76);
    ctx.voltLCD = voltLCD; ctx.ammLCD = ammLCD;

    const MW = .25, MH = .115, MD = .2;
    const vm = makeMeter('VOLTMÈTRE', 'V ⎓', 'V+', 'V-', 'V/Ω/mA', voltLCD);
    levelA.add(vm);
    placeDevice(vm, {
        angDeg: -40, w: MW, h: MH, d: MD,
        label: 'Voltmètre', termIds: ['V+', 'V-']
    });

    const am = makeMeter('AMPÈREMÈTRE', 'mA ⎓', 'A+', 'A-', 'V/Ω/mA', ammLCD);
    levelA.add(am);
    placeDevice(am, {
        angDeg: 40, w: MW, h: MH, d: MD,
        label: 'Ampèremètre', termIds: ['A+', 'A-']
    });

    return { voltLCD, ammLCD };
}

/* ================================================================== */
/*  BOÎTE DE RÉSISTANCE — carte schématique plate (niveau A)           */
/*  Vue de face : texte simplifié + symbole --!!!!---                  */
/*  L'élément 3D réel (résistance bobinée) reste « dans le dos »       */
/*  (dos de la carte) ; côté joueur = étiquette minimaliste.           */
/* ================================================================== */
export function buildResistorBlock(levelA) {
    const g = new THREE.Group();
    const W = .24, H = .005, D = .16;

    /* ---- support : fine plaque bakélite (comme une carte d'étiquette) ---- */
    const plate = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), MAT.bakelite());
    plate.castShadow = plate.receiveShadow = true;
    g.add(plate);

    /* ---- face avant : étiquette schématique imprimée ---- */
    const label = panelPlane(W, D, 480, 320, (ctx2, Wp, Hp) => {
        /* fond bakélite sombre */
        ctx2.fillStyle = '#2b2118'; ctx2.fillRect(0, 0, Wp, Hp);
        ctx2.strokeStyle = 'rgba(255,255,255,.18)'; ctx2.lineWidth = 3;
        ctx2.strokeRect(6, 6, Wp - 12, Hp - 12);

        /* nom court */
        ctx2.fillStyle = '#f0e2c8'; ctx2.font = '700 36px "Space Grotesk",sans-serif';
        ctx2.textAlign = 'center';
        ctx2.fillText('R', Wp / 2, 72);

        /* symbole schématique européen : --!!!!--- */
        ctx2.fillStyle = '#e8c258'; ctx2.font = '700 42px "JetBrains Mono",monospace';
        ctx2.fillText('--\u2588\u2588\u2588\u2588--', Wp / 2, 160);

        /* lignes de connexion stylisées */
        ctx2.strokeStyle = '#e8c258'; ctx2.lineWidth = 4;
        ctx2.beginPath(); ctx2.moveTo(40, 160); ctx2.lineTo(120, 160); ctx2.stroke();
        ctx2.beginPath(); ctx2.moveTo(Wp - 40, 160); ctx2.lineTo(Wp - 120, 160); ctx2.stroke();

        /* valeur */
        ctx2.fillStyle = '#c9b592'; ctx2.font = '500 24px "Space Grotesk",sans-serif';
        ctx2.fillText('valeur à mesurer', Wp / 2, 224);

        /* bornes */
        ctx2.fillStyle = '#ef6461'; ctx2.font = '700 28px "Space Grotesk",sans-serif';
        ctx2.fillText('A', 60, 300);
        ctx2.fillStyle = '#8ea2bb';
        ctx2.fillText('B', Wp - 60, 300);
    });
    /* la face imprimée est à plat sur le dessus de la plaque */
    label.mesh.rotation.x = -Math.PI / 2;
    label.mesh.position.y = H / 2 + .001;
    g.add(label.mesh);

    /* ---- bornes accessibles sur la face AVANT (z positif) ---- */
    g.add(addAt(makeTerminal('R1', 'borne A de R', 0xd93a3a, 'z', g), -.07, .02, D / 2));
    g.add(addAt(makeTerminal('R2', 'borne B de R', 0x1c1f27, 'z', g),  .07, .02, D / 2));

    levelA.add(g);
    placeDevice(g, { angDeg: 90, w: W, h: H + .03, d: D, label: 'Résistance R', termIds: ['R1', 'R2'] });
    return g;
}


/* ================================================================== */
/*  BOÎTE À RÉSISTANCES À DÉCADES (niveau B)                           */
/* ================================================================== */
export function buildDecadeBox(levelB) {
    const g = new THREE.Group();
    const w = .52, h = .16, d = .3;
    g.add(makeShell(w, h, d));
    addFeet(g, w * .92, d * .86, .016, -h / 2, .015);

    const panel = panelPlane(.5, .15, 1024, 300, (ctx2, W, H) => {
        ctx2.fillStyle = '#1b1f28'; ctx2.fillRect(0, 0, W, H);
        const gr = ctx2.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, 'rgba(255,255,255,.06)'); gr.addColorStop(1, 'rgba(0,0,0,.22)');
        ctx2.fillStyle = gr; ctx2.fillRect(0, 0, W, H);
        ctx2.textAlign = 'center';
        ctx2.fillStyle = '#e6c56a'; ctx2.font = '700 25px "Space Grotesk",sans-serif';
        ctx2.fillText('BOÎTE À RÉSISTANCES À DÉCADES', W / 2, 30);
        ctx2.fillStyle = '#93a5c4'; ctx2.font = '600 19px "Space Grotesk",sans-serif';
        ['×1000', '×100', '×10', '×1'].forEach((t, i) => ctx2.fillText(t, 186 + i * 208, 62));
        ctx2.fillStyle = '#7f90ab'; ctx2.font = '500 16px "Space Grotesk",sans-serif';
        ctx2.fillText('Ω', 186 + 0 * 208 + 62, 62); ctx2.fillText('Ω', 186 + 1 * 208 + 55, 62);
        ctx2.fillText('Ω', 186 + 2 * 208 + 48, 62); ctx2.fillText('Ω', 186 + 3 * 208 + 42, 62);
        /* fenêtres des tambours chiffrés (les écrans 3D viennent dessus) */
        ctx2.fillStyle = '#0d1015';
        for (let i = 0; i < 4; i++) { rr(ctx2, 186 + i * 208 - 34, 76, 68, 82, 6); ctx2.fill(); }
        ctx2.strokeStyle = 'rgba(232,197,106,.35)'; ctx2.lineWidth = 2;
        for (let i = 0; i < 4; i++) { rr(ctx2, 186 + i * 208 - 34, 76, 68, 82, 6); ctx2.stroke(); }
        /* repères des boutons */
        ctx2.strokeStyle = '#4d5b72'; ctx2.lineWidth = 2.4;
        for (let i = 0; i < 4; i++) {
            ctx2.beginPath(); ctx2.arc(186 + i * 208, 222, 40, 0, 7); ctx2.stroke();
        }
        ctx2.fillStyle = '#c3cad6'; ctx2.font = '700 22px "Space Grotesk",sans-serif';
        ctx2.fillText('A', 946, 150); ctx2.fillText('B', 946, 235);
        ctx2.fillStyle = '#6d7f9c'; ctx2.font = '600 17px "Space Grotesk",sans-serif';
        ctx2.fillText('SORTIE', 946, 66);
        ctx2.textAlign = 'left';
        ctx2.fillStyle = '#7f90ab'; ctx2.font = '500 16px "Space Grotesk",sans-serif';
        ctx2.fillText('R max 9999 Ω · 0,25 W', 26, 285);
        ctx2.textAlign = 'right';
        ctx2.fillText('type DR-4 · n° 0417', W - 26, 285);
    });
    panel.mesh.position.z = d / 2 + .001; g.add(panel.mesh);

    const dialKnobs = [], digitWins = [];
    for (let i = 0; i < 4; i++) {
        const x = -.1575 + i * .104;

        /* fenêtre du tambour chiffré (dessiné dans displays.js) */
        // AFTER
const lcd = makeLCD(96, 112);              // { c, ctx, tex }
const win = new THREE.Mesh(new THREE.PlaneGeometry(.046, .054),
    new THREE.MeshBasicMaterial({ map: lcd.tex }));
win.position.set(x, .0405, d / 2 + .006); g.add(win);
digitWins.push({ ctx: lcd.ctx, tex: lcd.tex });   // ← pass the 2D context

        /* bouton cranté */
        const dial = makeKnob(.031, .016, 0xf2f5fa);
        dial.position.set(x, -.0285, d / 2 + .004);
        dial.userData = { interact: true, kind: 'dial', index: i, tip: '' };
        addTicks(g, x, -.0285, d / 2 + .003, .04, .047, 11, 300, 0x7f90ab);
        dialKnobs.push(dial); g.add(dial); interactives.push(dial);
    }
    g.add(addAt(makeTerminal('RB1', 'sortie S1 de la boîte', 0xd93a3a, 'z', g), .215, .045, d / 2));
    g.add(addAt(makeTerminal('RB2', 'sortie S2 de la boîte', 0x1c1f27, 'z', g), .215, -.045, d / 2));

    levelB.add(g);
    placeDevice(g, { angDeg: 136, w, h, d, label: 'Boîte à décades', termIds: ['RB1', 'RB2'] });
    ctx.dialKnobs = dialKnobs; ctx.digitWins = digitWins;
    /* compatibilité : l'ancien nom reste présent (vide) pour les tests */
    ctx.digitLCDs = [];
    return g;
}

/* ================================================================== */
/*  GALVANOMÈTRE à zéro central (niveau B)                             */
/* ================================================================== */
export function buildGalvanometer(levelB) {
    const g = new THREE.Group();
    const w = .27, h = .15, d = .11;

    /* socle bakélite + boîtier crème */
    const basePlinth = new THREE.Mesh(new RoundedBoxGeometry(w + .012, .022, d + .012, 3, .006), MAT.bakelite());
    basePlinth.position.y = -h / 2 - .004; basePlinth.castShadow = basePlinth.receiveShadow = true;
    g.add(basePlinth);
    const caseMesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, .014), MAT.cream());
    caseMesh.castShadow = caseMesh.receiveShadow = true; g.add(caseMesh);
    addFeet(g, w * .86, d * .76, .011, -h / 2 - .015, .012);

    const face = panelPlane(.25, .135, 500, 270, (ctx2, W, H) => {
        ctx2.fillStyle = '#efe8d6'; ctx2.fillRect(0, 0, W, H);
        ctx2.strokeStyle = '#3a4256'; ctx2.lineWidth = 3; ctx2.strokeRect(4, 4, W - 8, H - 8);
        const cx = W / 2, cy = H * .86, r = H * .68;

        /* bande de miroir anti-parallaxe (le vrai geste de lecture) */
        const mg = ctx2.createLinearGradient(0, cy - r - 6, 0, cy - r + 22);
        mg.addColorStop(0, 'rgba(190,205,220,.15)'); mg.addColorStop(.5, 'rgba(225,235,245,.75)');
        mg.addColorStop(1, 'rgba(160,175,195,.2)');
        ctx2.fillStyle = mg;
        ctx2.beginPath();
        ctx2.arc(cx, cy, r + 12, -Math.PI / 2 - .66, -Math.PI / 2 + .66);
        ctx2.arc(cx, cy, r - 30, -Math.PI / 2 + .66, -Math.PI / 2 - .66, true);
        ctx2.closePath(); ctx2.fill();

        /* échelle gravée */
        ctx2.lineWidth = 3; ctx2.strokeStyle = '#3a4256';
        ctx2.beginPath(); ctx2.arc(cx, cy, r, -Math.PI / 2 - .62, -Math.PI / 2 + .62); ctx2.stroke();
        ctx2.font = '600 20px "Space Grotesk",sans-serif'; ctx2.textAlign = 'center';
        for (let i = -5; i <= 5; i++) {
            const a = -Math.PI / 2 + (i / 5) * .62;
            const x1 = cx + Math.cos(a) * r, y1 = cy + Math.sin(a) * r;
            const len = (i === 0 ? 17 : (i % 5 === 0 ? 12 : 9));
            const x2 = cx + Math.cos(a) * (r - len), y2 = cy + Math.sin(a) * (r - len);
            ctx2.lineWidth = (i === 0) ? 4 : 2.2;
            ctx2.strokeStyle = (i === 0) ? '#c0392b' : '#3a4256';
            ctx2.beginPath(); ctx2.moveTo(x1, y1); ctx2.lineTo(x2, y2); ctx2.stroke();
            if (Math.abs(i) % 5 === 0 || i === 0) {
                const lx = cx + Math.cos(a) * (r + 26), ly = cy + Math.sin(a) * (r + 26);
                ctx2.fillStyle = (i === 0) ? '#c0392b' : '#3a4256';
                ctx2.fillText(String(Math.abs(i)), lx, ly);
            }
        }
        ctx2.fillStyle = '#3a4256'; ctx2.font = '700 21px "Space Grotesk",sans-serif';
        ctx2.fillText('GALVANOMÈTRE', cx, 32);
        ctx2.font = '500 15px "Space Grotesk",sans-serif'; ctx2.fillStyle = '#6b7488';
        ctx2.fillText('zéro au centre · 100 µA · classe 1,5', cx, 54);
        ctx2.fillStyle = '#c0392b'; ctx2.font = '700 20px "Space Grotesk",sans-serif';
        ctx2.fillText('−', cx - 92, 54); ctx2.fillText('+', cx + 92, 54);
        ctx2.fillStyle = '#6b7488'; ctx2.font = '600 12px "Space Grotesk",sans-serif';
        ctx2.fillText('RÉGLAGE DU ZÉRO', cx, H - 12);
    });
    face.mesh.position.z = d / 2 + .001; g.add(face.mesh);

    /* aiguille + pivot */
    const pivot = new THREE.Group();
    pivot.position.set(0, -.0481, d / 2 + .006);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(.0035, .078, .002),
        new THREE.MeshStandardMaterial({ color: 0xc0392b, emissive: 0x7c1f14, emissiveIntensity: .4 }));
    needle.position.y = .039; pivot.add(needle);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .006, 16),
        new THREE.MeshStandardMaterial({ color: 0x2b3140, metalness: .6, roughness: .35 }));
    cap.rotation.x = Math.PI / 2; pivot.add(cap);
    g.add(pivot);

    /* vitre de protection (léger reflet, n'empêche pas de lire) */
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(.235, .1),
        new THREE.MeshStandardMaterial({
            color: 0xdfeaf5, transparent: true, opacity: .09, roughness: .06, metalness: .1
        }));
    glass.position.set(0, .012, d / 2 + .012);
    glass.userData = { ignorePick: true };
    g.add(glass);

    /* bouton de réglage du zéro */
    const zero = new THREE.Mesh(new THREE.CylinderGeometry(.009, .011, .008, 18), MAT.dark());
    zero.rotation.x = Math.PI / 2; zero.position.set(0, -.062, d / 2 + .004);
    zero.userData = { ignorePick: true, ignore: true };
    g.add(zero);

    g.add(addAt(makeTerminal('GA-', 'borne − du galvanomètre', 0x1c1f27, 'z', g), -.085, -.056, d / 2));
    g.add(addAt(makeTerminal('GA+', 'borne + du galvanomètre', 0xd93a3a, 'z', g), .085, -.056, d / 2));

    levelB.add(g);
    placeDevice(g, { angDeg: -104, w, h, d, label: 'Galvanomètre', termIds: ['GA+', 'GA-'] });
    ctx.galvoPivot = pivot;
    return g;
}

/* ================================================================== */
/*  CARTE DU PONT DE WHEATSTONE (posée à plat au centre : seule
    exception à la règle « face au centre »)                           */
/* ================================================================== */
export function buildBridgeBoard(levelB) {
    const g = new THREE.Group();
    const W = .5, D = .36;

    /* circuit imprimé vert */
    const base = new THREE.Mesh(new RoundedBoxGeometry(W, .018, D, 3, .004), MAT.pcb());
    base.castShadow = base.receiveShadow = true; g.add(base);

    const print = panelPlane(.48, .34, 560, 400, (ctx2, Wp, Hp) => {
        ctx2.fillStyle = '#1d5c3a'; ctx2.fillRect(0, 0, Wp, Hp);
        /* trame de pastilles / pistes */
        ctx2.strokeStyle = 'rgba(255,255,255,.08)'; ctx2.lineWidth = 1;
        for (let x = 12; x < Wp; x += 22) { ctx2.beginPath(); ctx2.moveTo(x, 8); ctx2.lineTo(x, Hp - 8); ctx2.stroke(); }
        ctx2.strokeStyle = 'rgba(255,255,255,.16)'; ctx2.lineWidth = 2;
        ctx2.strokeRect(8, 8, Wp - 16, Hp - 16);

        ctx2.fillStyle = '#f2f7ee'; ctx2.font = '700 22px "Space Grotesk",sans-serif'; ctx2.textAlign = 'center';
        ctx2.fillText('PONT DE WHEATSTONE', Wp / 2, 32);
        ctx2.font = '500 14px "Space Grotesk",sans-serif'; ctx2.fillStyle = '#cfe3cf';
        ctx2.fillText('à l\'équilibre : Rx = (R2 / R1) · Rv', Wp / 2, 52);

        const P = { W: [70, 200], E: [490, 200], N: [280, 80], S: [280, 320] };
        /* pistes cuivre du pont */
        ctx2.strokeStyle = '#e8c258'; ctx2.lineWidth = 5; ctx2.lineJoin = 'round';
        ctx2.beginPath();
        ctx2.moveTo(...P.W); ctx2.lineTo(...P.N); ctx2.lineTo(...P.E); ctx2.lineTo(...P.S);
        ctx2.closePath(); ctx2.stroke();
        /* diagonale du galvanomètre */
        ctx2.strokeStyle = '#9fd8ff'; ctx2.lineWidth = 4;
        ctx2.beginPath(); ctx2.moveTo(...P.N); ctx2.lineTo(...P.S); ctx2.stroke();
        ctx2.beginPath(); ctx2.arc(280, 200, 18, 0, 7); ctx2.stroke();
        ctx2.fillStyle = '#9fd8ff'; ctx2.font = '700 19px "Space Grotesk",sans-serif';
        ctx2.fillText('G', 280, 207);

        /* emplacements sérigraphiés des composants */
        const seat = (x1, y1, x2, y2, label, sub) => {
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
            const nx = -dy / L, ny = dx / L;
            ctx2.strokeStyle = 'rgba(255,255,255,.55)'; ctx2.lineWidth = 2;
            ctx2.beginPath();
            ctx2.moveTo(x1 + dx * .25, y1 + dy * .25); ctx2.lineTo(x1 + dx * .75, y1 + dy * .75);
            ctx2.stroke();
            ctx2.fillStyle = '#f2f7ee'; ctx2.font = '700 18px "Space Grotesk",sans-serif';
            ctx2.fillText(label, mx + nx * 30, my + ny * 30 + 6);
            ctx2.fillStyle = '#cfe3cf'; ctx2.font = '500 14px "Space Grotesk",sans-serif';
            ctx2.fillText(sub, mx + nx * 52, my + ny * 52 + 5);
        };
        seat(...P.W, ...P.N, 'R1', '1 kΩ');
        seat(...P.N, ...P.E, 'Rv', 'boîte à décades');
        seat(...P.W, ...P.S, 'R2', '1 kΩ');
        seat(...P.S, ...P.E, 'Rx', '= ?');
        ctx2.fillStyle = '#f2f7ee'; ctx2.font = '600 17px "Space Grotesk",sans-serif';
        ctx2.fillText('P+', 42, 292); ctx2.fillText('P−', 518, 292);
        ctx2.fillText('M1', 42, 66); ctx2.fillText('M2', 518, 66);
    });
    print.mesh.rotation.x = -Math.PI / 2; print.mesh.position.y = .0101; g.add(print.mesh);

    /* quatre résistances réelles (corps brun + code de couleurs) */
    const resistor = (x, z, rotY, len = .085) => {
        const grp = new THREE.Group();
        const bodyR = new THREE.Mesh(new THREE.CylinderGeometry(.0125, .0125, len, 18),
            new THREE.MeshStandardMaterial({ map: resistorBandTexture(), roughness: .62 }));
        bodyR.rotation.z = Math.PI / 2; bodyR.castShadow = true; grp.add(bodyR);
        const lead = MAT.steel();
        [-1, 1].forEach(s => {
            const l = new THREE.Mesh(new THREE.CylinderGeometry(.0022, .0022, .03, 8), lead);
            l.rotation.z = Math.PI / 2; l.position.x = s * (len / 2 + .014); grp.add(l);
        });
        grp.position.set(x, .023, z);
        grp.rotation.y = rotY;
        g.add(grp);
    };
    /* positions alignées sur les emplacements sérigraphiés du losange
       (conversion exacte : x = (px/560 − ½)·0,48 ; z = (py/400 − ½)·0,34) */
    resistor(-.064, -.021, Math.PI / 4, .07);      // R1  (bras W→N)
    resistor(.064, -.021, -Math.PI / 4, .07);      // Rv  (bras N→E)
    resistor(-.064, .021, -Math.PI / 4, .07);      // R2  (bras W→S)
    resistor(.064, .021, Math.PI / 4, .07);        // Rx  (bras S→E, l'inconnue)

    /* réglette en laiton + curseur (bras du galvanomètre) */
    const rail = new THREE.Mesh(new THREE.BoxGeometry(.016, .008, .15), MAT.brass());
    rail.position.set(0, .019, 0); rail.castShadow = true; g.add(rail);
    const slider = new THREE.Mesh(new THREE.BoxGeometry(.028, .016, .024), MAT.steel());
    slider.position.set(0, .024, .012); g.add(slider);

    /* douilles : alimentation P+/P− et points milieux M1/M2 */
    g.add(addAt(makeTerminal('P+', 'P+ (alimentation du pont)', 0xd93a3a, 'y', g), -.2, .012, .135));
    g.add(addAt(makeTerminal('P-', 'P− (alimentation du pont)', 0x1c1f27, 'y', g), .2, .012, .135));
    g.add(addAt(makeTerminal('M1', 'M1 (point milieu gauche)', 0xe8c258, 'y', g), -.2, .012, -.135));
    g.add(addAt(makeTerminal('M2', 'M2 (point milieu droit)', 0x9fd8ff, 'y', g), .2, .012, -.135));

    /* pieds caoutchouc */
    addFeet(g, W * .86, D * .8, .011, -.009, .011);

    const bottom = lowestLocalY(g, .018);
    g.scale.setScalar(K);
    const yOff = -bottom * K + .001;
    g.position.set(0, TABLE_H + yOff, .02);              // à plat, au centre de la table
    g.rotation.y = 0;                                    // pas d'orientation « face au centre »
    levelB.add(g);
    const dr = registerDevice(g, 'Carte du pont de Wheatstone', ['P+', 'P-', 'M1', 'M2'], yOff, false);
    dr.halfW = W / 2 * K; dr.halfD = D / 2 * K;
    return g;
}

/* ================================================================== */
/*  Assemblage : niveaux A / B autour de la table                      */
/* ================================================================== */
export function buildInstruments() {
    const scene = ctx.scene;
    const levelA = new THREE.Group(), levelB = new THREE.Group();
    scene.add(levelA, levelB);
    ctx.levelA = levelA; ctx.levelB = levelB;
    levelB.visible = false;

    /* le générateur est commun aux deux niveaux : il reste dans la scène,
       hors des groupes A/B qui sont masqués alternativement */
    scene.add(buildGenerator());
    buildMeters(levelA);
    buildResistorBlock(levelA);
    buildDecadeBox(levelB);
    buildGalvanometer(levelB);
    buildBridgeBoard(levelB);

    return { levelA, levelB };
}

export { ringPos, faceCenter, placeDevice, addFeet, addHandle, addTicks, makeKnob, MAT, TABLE_R, K as INSTR_SCALE };
