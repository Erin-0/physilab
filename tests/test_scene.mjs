/* =====================================================================
   tests/test_scene.mjs — contrôle du graphe de scène et de la disposition
   du poste de travail :
     • tout ce qui est interactif est bien rattaché à la scène (rien
       d'« oublié » hors rendu) ;
     • les appareils sont disposés en couronne autour de la table ronde,
       face avant tournée vers le centre ;
     • la carte du pont reste à plat (seule exception) ;
     • le bureau, la feuille et le stylo sont à droite de la pièce ;
     • le générateur est bien livré éteint.
   ===================================================================== */
import { install } from './domstub.mjs';
install();
await import('../js/main.js');

const state = await import('../js/state.js');
const { S, ctx, terminals, allTermIds, draggables, interactives } = state;

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { c ? (pass++, console.log('  ✓', l, x)) : (fail++, console.log('  ✗', l, x)); };

/* ---- utilitaires géométriques ---- */
function inScene(o) {
    let p = o;
    while (p) { if (p === ctx.scene) return true; p = p.parent; }
    return false;
}
function visiblePath(o) {
    let p = o;
    while (p && p !== ctx.scene) { if (p.visible === false) return false; p = p.parent; }
    return true;
}
const world = (o) => { o.updateMatrixWorld(true);
    const m = o.matrixWorld.elements || o.matrixWorld;
    return { x: m[12], y: m[13], z: m[14] }; };

/* ---- 1. graphe de scène ---- */
chk('la scène existe', !!ctx.scene);
const missingTerms = allTermIds.filter(id => !terminals[id].group || !inScene(terminals[id].group));
chk('les 16 bornes sont rattachées à la scène', missingTerms.length === 0, missingTerms.join(','));
const missingDrag = draggables.filter(d => !inScene(d.obj));
chk('les 9 objets déplaçables sont rattachés à la scène', missingDrag.length === 0,
    missingDrag.map(d => d.label).join(','));
const missingInter = interactives.filter(o => !inScene(o));
chk('tous les objets interactifs sont dans la scène', missingInter.length === 0, missingInter.length + ' orphelin(s)');
chk('groupe niveau A visible, groupe niveau B masqué au départ',
    ctx.levelA.visible === true && ctx.levelB.visible === false);
chk('le générateur reste visible quel que soit le niveau', inScene(ctx.genGroup) && visiblePath(ctx.genGroup));

/* ---- 2. générateur livré éteint ---- */
chk('générateur ÉTEINT et à 0 V au démarrage', S.genOn === false && S.setV === 0);

/* ---- 3. couronne d'appareils autour de la table ronde ---- */
const { TABLE_R, TABLE_H, DESK } = state;
const ring = draggables.filter(d => d.label !== 'Feuille de relevés' && d.label !== 'Stylo noir');
let onTable = 0, facesCenter = 0;
for (const d of ring) {
    const w = world(d.obj);
    const r = Math.hypot(w.x, w.z);
    if (r < TABLE_R - .05 && Math.abs(w.y - TABLE_H) < .3) onTable++;
    /* la face avant (+Z local) doit pointer vers le centre : produit scalaire > 0 */
    const fx = Math.sin(d.obj.rotation.y), fz = Math.cos(d.obj.rotation.y);
    const toCenterX = -w.x / (r || 1), toCenterZ = -w.z / (r || 1);
    const dot = fx * toCenterX + fz * toCenterZ;
    /* la carte du pont est la seule exception : posée à plat, non orientée */
    if (d.label.startsWith('Carte du pont')) facesCenter++;
    else if (dot > .99) facesCenter++;
    else console.log(`      (${d.label} : dot=${dot.toFixed(3)}, r=${r.toFixed(2)})`);
}
chk('tous les appareils sont posés sur la paillasse circulaire', onTable === ring.length, `${onTable}/${ring.length}`);
chk('face avant tournée vers le centre (sauf la carte du pont)', facesCenter === ring.length, `${facesCenter}/${ring.length}`);

const carte = draggables.find(d => d.label.startsWith('Carte du pont'));
const cw = carte ? world(carte.obj) : { x: 9, z: 9 };
chk('la carte du pont est au centre de la table et à plat',
    !!carte && Math.abs(carte.obj.rotation.x) < 1e-9 && Math.hypot(cw.x, cw.z) < .2,
    `x=${cw.x.toFixed(2)} z=${cw.z.toFixed(2)}`);

/* ---- 4. bureau des relevés à droite ---- */
chk('le bureau est à droite de la pièce', DESK.x > 1.5, `x=${DESK.x}`);
const paper = draggables.find(d => d.label === 'Feuille de relevés');
const pen = draggables.find(d => d.label === 'Stylo noir');
chk('feuille et stylo existent et sont interactifs',
    !!(paper && pen) && ctx.paperObj.userData.kind === 'paper' && ctx.penObj.userData.kind === 'pen');
const pw = world(ctx.paperObj), nw = world(ctx.penObj);
chk('feuille posée sur le bureau', Math.abs(pw.y - DESK.h) < .05, `y=${pw.y.toFixed(3)} (bureau h=${DESK.h})`);
chk('stylo posé sur le bureau', Math.abs(nw.y - DESK.h) < .06, `y=${nw.y.toFixed(3)}`);
chk('feuille et stylo du même côté que le bureau', pw.x > 1.5 && nw.x > 1.5,
    `feuille x=${pw.x.toFixed(3)} z=${pw.z.toFixed(3)} · stylo x=${nw.x.toFixed(3)} z=${nw.z.toFixed(3)}`);

/* ---- 4 bis. taille des appareils : agrandis mais réalistes ---- */
const { INSTR_SCALE } = state;
const scaled = ring.filter(d => Math.abs(d.obj.scale.x - INSTR_SCALE) < 1e-9);
chk('tous les appareils portent le même facteur d\'agrandissement',
    scaled.length === ring.length, `${scaled.length}/${ring.length} à ×${INSTR_SCALE}`);
chk('agrandissement raisonnable (10 à 30 %) pour garder l\'échelle du réel',
    INSTR_SCALE > 1.05 && INSTR_SCALE < 1.35, '×' + INSTR_SCALE);
const dims = ring.map(d => ({ l: d.label, L: d.halfW * 2, P: d.halfD * 2 }))
    .sort((a, b) => b.L - a.L);
chk('le plus grand appareil reste plus petit que la table',
    dims[0].L < TABLE_R * 2, `${dims[0].l} : ${dims[0].L.toFixed(2)} m < ${TABLE_R * 2} m`);
chk('le plus petit appareil reste manipulable (>= 10 cm)',
    Math.min(...dims.map(d => Math.min(d.L, d.P))) >= .10,
    dims.map(d => `${d.l} ${Math.min(d.L, d.P).toFixed(2)} m`).join(' · '));

/* ---- 4 ter. chaque objet repose réellement sur son support ----
   On mesure le point le plus BAS de l'objet (tests/extents.mjs) et on le
   compare à l'altitude du plateau : un appareil ne doit ni flotter au-dessus
   de la paillasse, ni s'y enfoncer.                                     */
const { supportAt } = await import('../js/environment.js');
const { worldMinY } = await import('./extents.mjs');
let resting = 0, aligned = 0;
const gaps = [];
for (const d of draggables) {
    const w = world(d.obj);
    const onDesk = d.label === 'Feuille de relevés' || d.label === 'Stylo noir';
    const sup = onDesk ? { y: DESK.h, name: 'bureau' } : supportAt(w.x, w.z);
    if (!sup) { gaps.push(`${d.label}: sans support`); continue; }
    const ecart = worldMinY(d.obj) - sup.y;
    gaps.push(`${d.label} ${(ecart >= 0 ? '+' : '') + (ecart * 1000).toFixed(1)} mm`);
    if (Math.abs(ecart) <= .005) resting++;
    else console.log(`      (${d.label} : ${ecart >= 0 ? 'flotte de' : 'enfoncé de'} ${Math.abs(ecart * 1000).toFixed(1)} mm)`);
    if (Math.abs(w.y - (sup.y + d.yOff)) < 1e-6) aligned++;
}
chk('chaque objet repose sur son support (ni flottant, ni enfoncé, ±5 mm)',
    resting === draggables.length, `${resting}/${draggables.length}`);
console.log('      ' + gaps.join(' · '));
chk('origine des appareils cohérente avec leur hauteur de pose', aligned === draggables.length,
    `${aligned}/${draggables.length}`);

/* ---- 4 quater. boîte à décades : tambours mécaniques, pas d'écran ---- */
chk('la boîte à décades affiche 4 tambours chiffrés',
    (ctx.digitWins || []).length === 4 && (ctx.digitLCDs || []).length === 0,
    `${(ctx.digitWins || []).length} tambour(s)`);

/* ---- 4 quinquies. éclairage réglable, lumières enregistrées ---- */
const lighting = await import('../js/lighting.js');
chk('les lumières de la salle sont pilotables', !!(ctx.lights && ctx.lights.spot && ctx.lights.hemi
    && ctx.lights.fills.length === 2 && ctx.lights.desk && ctx.lights.lampMats.length === 2));
state.L.preset = 'daylight'; state.L.slider = 1.2; lighting.applyLighting(true);
chk('l\'ambiance « Plein jour » éclaire plus que « Veillée »',
    ctx.lights.hemi.intensity > 1.0 && ctx.renderer.toneMappingExposure > 1.5,
    `hémisphère ${ctx.lights.hemi.intensity.toFixed(2)}, exposition ${ctx.renderer.toneMappingExposure.toFixed(2)}`);
state.L.preset = 'lab'; state.L.slider = 1; lighting.applyLighting(true);

/* ---- 5. le joueur arrive face à la table ---- */
chk('position de départ derrière la table, à hauteur d\'yeux debout',
    Math.abs(ctx.yawObj.position.z - 3.35) < 1e-6 && Math.abs(ctx.yawObj.position.y - 1.62) < 1e-6,
    `z=${ctx.yawObj.position.z}, y=${ctx.yawObj.position.y}`);

console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
