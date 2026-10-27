import { install } from './domstub.mjs';
install();
/* charge le VRAI point d'entrée du jeu */
await import('../js/main.js');
console.log('  ✓ main.js s\'est chargé et exécuté sans erreur');

const state = await import('../js/state.js');
const hud = await import('../js/hud.js');
const circuit = await import('../js/circuit.js');
const drag = await import('../js/drag.js');
const avatar = await import('../js/avatar.js');
const player = await import('../js/player.js');
const net = await import('../js/net.js');
const displays = await import('../js/displays.js');

let pass = 0, fail = 0;
const chk = (l, c, x = '') => { c ? (pass++, console.log('  ✓', l, x)) : (fail++, console.log('  ✗', l, x)); };

/* ---- registres ---- */
chk('16 bornes enregistrées', state.allTermIds.length === 16, state.allTermIds.length + ' : ' + state.allTermIds.join(','));
chk('objets interactifs > 20', state.interactives.length > 20, state.interactives.length);
chk('objets déplaçables = 9 (7 appareils + feuille + stylo)', state.draggables.length === 9, state.draggables.map(d => d.label).join(' | '));
chk('générateur livré ÉTEINT et à 0 V', state.S.genOn === false && state.S.setV === 0);

/* ---- feuille de relevés (saisie manuelle) ---- */
hud.openPaper(true);
chk('la feuille s\'ouvre', hud.isPaperOpen() === true);
hud.addBlankRow(false);
chk('une ligne VIDE est ajoutée (pas de valeurs auto)',
    hud.rows.length === 1 && hud.rows[0].U === '' && hud.rows[0].I === '' && hud.rows[0].R === '',
    JSON.stringify(hud.rows[0]));
hud.renderTable();
chk('le tableau se dessine', document.getElementById('cahierBody').innerHTML.includes('cellin'));
hud.rows[0].U = '5,00'; hud.rows[0].I = '49,5'; hud.rows[0].lvl = 'A';
hud.renderTable();
chk('export CSV possible après saisie manuelle', typeof hud.exportCSV === 'function');
hud.openPaper(false);
chk('la feuille se referme', hud.isPaperOpen() === false);

/* ---- niveau B : générateur remis à zéro ---- */
state.S.genOn = true; state.S.setV = 7;
state.S.level = 'B'; circuit.resetGeneratorState();
chk('changement de niveau -> générateur éteint', state.S.genOn === false && state.S.setV === 0);

/* ---- multijoueur : avatar local simple (ni bras ni jambes) ---- */
chk('avatar local créé', avatar.peers.has('me'));
const a = avatar.peers.get('me');
let meshes = 0, capsules = 0;
a.group.traverse(o => { if (o.geometry) meshes++; });
chk('personnage composé de primitives simples', meshes >= 6 && meshes <= 14, meshes + ' maillages');
avatar.say('me', 'Bonjour le labo !');
chk('bulle de chat au-dessus de la tête', !!a.bubble);
avatar.hurtPeer('me', 1);
chk('flash rouge possible sur impact', a.hurt === 1);
avatar.update(0.016, 1.0, 'me');
chk('animation des avatars sans erreur', true);

/* ---- réseau ---- */
net.initIdentity();
chk('identité locale définie', state.ME.name.length > 0 && /^#[0-9a-f]{6}$/i.test(state.ME.color), state.ME.name + ' ' + state.ME.color);

/* ---- choix du mode de jeu ---- */
/* Le harnais charge l'adresse « ?nom=Testeur » : un nom dans l'URL signifie
   « je veux jouer à deux », donc le multijoueur est retenu au démarrage. */
chk('?nom=… dans l\'URL démarre en multijoueur', state.ME.solo === false);
chk('en multijoueur, mon personnage est présent', avatar.peers.has(state.ME.id || 'me'),
    [...avatar.peers.keys()].join(','));
avatar.setSolo(true);
chk('passage en solo : plus AUCUN personnage dans la scène', avatar.peers.size === 0,
    avatar.peers.size + ' avatar(s)');
avatar.setSolo(false);
avatar.addPeer(state.ME.id || 'me', state.ME.name + ' (moi)', state.ME.color, true);

/* ---- déplacement d'objet : PLUS AUCUNE CHUTE ---- */
const rec = state.draggables.find(d => d.label === 'Générateur 0–15 V');
const home = rec.obj.position.clone();
const homeYaw = rec.obj.rotation.y;
const w0 = drag.__test.worldXYZ(rec.obj, { x: 0, y: 0, z: 0 });
const homeWorld = { x: w0.x, y: w0.y, z: w0.z };

/* saisie (appui long déjà écoulé dans le harnais : on appelle beginDrag) */
drag.__test.beginDrag(rec);
chk('l\'objet est bien « saisi »', drag.isDragging() === true);

/* la rotation libre : un cran de molette = 7,5° */
const yaw0 = rec.obj.rotation.y;
drag.__test.rotateHeld(1);
const step = rec.obj.rotation.y - yaw0;
chk('la molette fait tourner l\'appareil (7,5° par cran)',
    Math.abs(step - Math.PI / 24) < 1e-9, (step * 180 / Math.PI).toFixed(2) + '°');

/* appui long sur le bouton droit : rotation rapide (×3,7) */
drag.__test.setFastSpin(true);
const yaw1 = rec.obj.rotation.y;
drag.__test.rotateHeld(1);
const stepFast = rec.obj.rotation.y - yaw1;
chk('appui long (bouton droit) : rotation plus rapide',
    Math.abs(stepFast / step - 3.7) < 1e-9,
    (stepFast * 180 / Math.PI).toFixed(2) + '° contre ' + (step * 180 / Math.PI).toFixed(2) + '°');
drag.__test.setFastSpin(false);

/* lâché au-dessus du vide : il NE TOMBE PAS, il revient sur le mobilier */
rec.lastGood = { x: homeWorld.x, y: homeWorld.y, z: homeWorld.z, yaw: rec.obj.rotation.y };
rec.obj.position.set(4.0, 1.6, 4.0);            // très loin de toute surface
drag.__test.release(rec);
const w1 = drag.__test.worldXYZ(rec.obj, { x: 0, y: 0, z: 0 });
chk('rien ne tombe : lâché dans le vide, l\'appareil revient se poser',
    Math.hypot(w1.x - homeWorld.x, w1.z - homeWorld.z) < 1e-6
    && Math.abs(w1.y - (state.TABLE_H + rec.yOff)) < 1e-6,
    `x=${w1.x.toFixed(3)} z=${w1.z.toFixed(3)} y=${w1.y.toFixed(4)}`);
chk('aucune physique de chute ne subsiste', rec.falling === undefined && rec.spin === undefined);
chk('l\'orientation choisie à la molette est conservée',
    Math.abs(rec.obj.rotation.y - (yaw1 + stepFast)) < 1e-9,
    (rec.obj.rotation.y * 180 / Math.PI).toFixed(1) + '°');
rec.obj.position.copy(home); rec.obj.rotation.set(0, homeYaw, 0); rec.lastGood = null;

/* ---- la boucle de déplacement ne fait jamais tomber un objet ---- */
rec.obj.position.set(0.2, state.TABLE_H + rec.yOff, 0.2);
for (let i = 0; i < 240; i++) drag.update(1 / 60, i / 60, { x: 0, y: 1.62, z: 3 });
chk('la boucle de déplacement ne déclenche aucune chute',
    rec.obj.position.y >= state.TABLE_H - 1e-9, `y=${rec.obj.position.y.toFixed(4)}`);
rec.obj.position.copy(home); rec.obj.rotation.set(0, homeYaw, 0);

/* ---- evaluate + afficheurs ---- */
state.S.level = 'A'; state.S.genOn = true; state.S.setV = 5;
state.wires.push({ a: 'G+', b: 'A+', color: 0, group: null }, { a: 'A-', b: 'R1', color: 0, group: null },
                 { a: 'R2', b: 'G-', color: 0, group: null }, { a: 'V+', b: 'R1', color: 0, group: null },
                 { a: 'V-', b: 'R2', color: 0, group: null });
state.ctx.evaluate();
displays.updateDisplays();
chk('circuit évalué depuis main.js', state.S.loopOk === true && state.S.montage === 'aval',
    `I=${(state.S.IA * 1000).toFixed(2)} mA, U=${state.S.UV.toFixed(3)} V, montage=${state.S.montage}`);

/* ---- clic sur le papier : NOUVELLE feuille vierge ---- */
hud.openPaper(false);
hud.rows.push({ lvl: 'A', montage: 'AVAL', U: '5,00', I: '49,5', R: '101,01', time: '10:00', obs: '' });
hud.newSheet();
chk('clic sur le papier : une feuille vierge est ouverte',
    hud.isPaperOpen() === true && hud.rows.length === 0, hud.rows.length + ' ligne(s)');
chk('les relevés précédents sont conservés en réserve', hud.sheets.length === 1, hud.sheets.length + ' feuille(s)');
const beforePrev = hud.sheets[0].length;
hud.prevSheet();
chk('on peut revenir à la feuille précédente',
    hud.rows.length === beforePrev && hud.sheets.length === 0,
    hud.rows.length + ' relevé(s) restauré(s)');
hud.rows.length = 0; hud.renderTable();

/* ---- boîte à décades : tambours chiffrés mécaniques ---- */
state.S.digits = [1, 2, 3, 4];
displays.updateDisplays();
displays.drawDrums(state.S.digits);
chk('la boîte à décades a 4 tambours chiffrés (sans écran)',
    (state.ctx.digitWins || []).length === 4, (state.ctx.digitWins || []).length + ' fenêtres');

/* ---- éclairage réglable ---- */
const lighting = await import('../js/lighting.js');
state.L.preset = 'dim'; state.L.slider = 1; lighting.applyLighting(true);
const dimHemi = state.ctx.lights.hemi.intensity;
state.L.preset = 'daylight'; state.L.slider = 1; lighting.applyLighting(true);
const dayHemi = state.ctx.lights.hemi.intensity;
chk('les ambiances d\'éclairage changent bien la lumière', dayHemi > dimHemi * 2,
    `hémisphère ${dimHemi.toFixed(2)} -> ${dayHemi.toFixed(2)}`);
state.L.slider = 1.5; lighting.applyLighting(true);
chk('le curseur d\'intensité agit sur toutes les lumières',
    state.ctx.lights.hemi.intensity > dayHemi * 1.4,
    (state.ctx.lights.hemi.intensity).toFixed(2));
state.L.preset = 'lab'; state.L.slider = 1; lighting.applyLighting(true);
chk('l\'exposition du rendu suit le réglage',
    state.ctx.renderer.toneMappingExposure > 0, state.ctx.renderer.toneMappingExposure.toFixed(2));

/* ---- mode SOLO : aucun personnage, aucun serveur ---- */
avatar.addPeer('x1', 'Voisin', '#f472b6', false);
chk('en multijoueur, un camarade est bien créé', avatar.peers.has('x1'));
avatar.setSolo(true);
chk('mode solo : TOUS les personnages disparaissent', avatar.peers.size === 0, avatar.peers.size + ' avatar(s)');
const pSolo = avatar.addPeer('x2', 'Encore un', '#a3e635', false);
chk('mode solo : plus aucun personnage ne peut être créé', pSolo === null && avatar.peers.size === 0);
state.ME.solo = true;
net.connect();
chk('mode solo : aucune connexion au serveur', state.ME.online === false && state.ME.transport === '—',
    state.ME.transport);
avatar.say('x2', 'test'); avatar.hurtPeer('x2', 1);
chk('mode solo : les fonctions « amis » ne cassent rien', true);
avatar.setSolo(false); state.ME.solo = false;

console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
