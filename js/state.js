/* =====================================================================
   js/state.js  —  état global de la simulation, presets graphiques,
                   registres partagés (bornes, objets interactifs) et
                   petits utilitaires.  Aucune dépendance Three.js ici :
                   ce module est importé en tout premier.
   ===================================================================== */

/* ---------- utilitaires ---------- */
export const $ = (id) => document.getElementById(id);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const fr = (n, d = 2) => (Number.isFinite(n) ? n : 0).toFixed(d).replace('.', ',');
export const rnd = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ---------- géométrie du mobilier (partagée : décor + collisions) ---------- */
export const ROOM = 5;                 // demi-largeur de la pièce (10 m × 10 m)
export const TABLE_R = 1.02;           // rayon de la paillasse circulaire
export const TABLE_H = 0.95;           // hauteur du plateau
export const DESK = { x: 3.0, z: 0.55, w: 1.15, d: 0.72, h: 0.78 };  // bureau « relevés »
export const DESK_ROT = -0.26;   // rad : le bureau pivote légèrement vers la pièce
                                 // (assez pour être esthétique, trop peu pour que la
                                 //  feuille et le stylo quittent le plateau)
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.17;

/* ---------- taille des appareils ----------
   Tous les instruments sont construits à leur taille réelle (mètres) puis
   multipliés par INSTR_SCALE : ils sont un peu plus gros qu'en vrai pour
   rester lisibles sur la paillasse, mais leurs PROPORTIONS demeurent celles
   d'un vrai laboratoire (même rapport entre l'appareil et la table).      */
export const INSTR_SCALE = 1.18;

/* ---------- presets de qualité graphique ---------- */
export const QPRESETS = {
    low: { label: 'Basse', pr: .7, shadows: false, shadowSize: 512, dust: false, dustN: 0, aniso: 1, tubeSeg: 14, tubeRad: 5, fog: .018, lcdFps: 12 },
    med: { label: 'Moyenne', pr: 1, shadows: true, shadowSize: 1024, dust: true, dustN: 90, aniso: 4, tubeSeg: 22, tubeRad: 6, fog: .024, lcdFps: 24 },
    high: { label: 'Haute', pr: 0, shadows: true, shadowSize: 2048, dust: true, dustN: 170, aniso: 8, tubeSeg: 30, tubeRad: 8, fog: .026, lcdFps: 60 }
};
export const Q = Object.assign({ level: 'high' }, QPRESETS.high);

/* ---------- presets d'éclairage (réglables en jeu, voir js/lighting.js) ---------- */
export const LPRESETS = {
    dim:      { label: 'Veillée',    expo: .82,  hemi: .28, spot: 104, fill: .45, desk: .55, lamp: 1.15 },
    lab:      { label: 'Atelier',    expo: 1.12, hemi: .50, spot: 150, fill: 1.00, desk: 1.00, lamp: 2.20 },
    bright:   { label: 'Lumineux',   expo: 1.38, hemi: .80, spot: 198, fill: 1.50, desk: 1.35, lamp: 2.75 },
    daylight: { label: 'Plein jour', expo: 1.62, hemi: 1.22, spot: 238, fill: 2.10, desk: 1.70, lamp: 3.10 }
};
export const L = { preset: 'lab', slider: 1 };   // slider : 0,7 … 1,5
export const allTextures = [];         // toutes les textures procédurales (anisotropie)

/* ---------- état de la simulation ---------- */
export const S = {
    level: 'A',
    /*  Le générateur démarre TOUJOURS éteint et à 0 V : c'est à l'élève de le
        mettre sous tension en premier (rien n'est « déjà prêt »).            */
    genOn: false, setV: 0,
    R: 100, rA: 1, rV: 1e7,                    // niveau A (Ω)
    R1: 1000, R2: 1000, Rg: 1000,              // pont de Wheatstone (Ω)
    digits: [0, 0, 0, 0], Rv: 0,               // boîte à décades
    Rx: 1200 + Math.floor(Math.random() * 3600),   // résistance inconnue
    faultShort: false, overload: false,
    loopOk: false, montage: '—', IA: 0, UV: 0,
    powered: false, boxIn: false, galvoConn: false, Vg: 0, balanced: false,
    recordedA: false, recordedB: false
};

/* ---------- registres 3D partagés ---------- */
export const terminals = {};           // id -> {group, ringMat, axis, label, owner}
export const allTermIds = [];
export const interactives = [];        // racines raycastables
export const draggables = [];          // {obj, label, termIds, baseOffset, yOff}
export const wires = [];               // {a, b, color, group}

/* ---------- contexte runtime (rempli par main.js) ---------- */
export const ctx = {
    scene: null, camera: null, renderer: null,
    yawObj: null, pitchObj: null,
    spot: null, dust: null,
    lights: null,          /* {hemi, spot, fills[], desk, lampMats[], expo0} */
    digitWins: [],         /* fenêtres des tambours chiffrés de la boîte à décades */
    meterSel: [],          /* sélecteurs rotatifs des multimètres (décor) */
    levelA: null, levelB: null,
    genGroup: null, genLCD: null, voltKnob: null, switchPivot: null, genLEDmat: null,
    voltLCD: null, ammLCD: null, digitLCDs: [], dialKnobs: [],
    galvoPivot: null, paperObj: null, penObj: null,
    /* callbacks (évite les imports circulaires) */
    evaluate: () => { },
    toast: () => { },
    openPaper: () => { },
    sfx: null
};

/* ---------- palette de fils ---------- */
export const PALETTE = [
    ['Rouge', 0xd93a3a], ['Noir', 0x232733], ['Bleu', 0x2f7de1],
    ['Vert', 0x2fbf71], ['Jaune', 0xf2c14e], ['Blanc', 0xe8e8ee]
];
export const wireColor = { current: 0xd93a3a };

/* ---------- identité du joueur local (multijoueur) ---------- */
export const ME = {
    solo: false,      /* mode solo : ni personnage, ni serveur, ni amis */
    id: null,
    name: 'Élève',
    color: '#22d3ee',
    online: false,
    transport: '—',
    room: '—'
};
