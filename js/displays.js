/* =====================================================================
   js/displays.js  —  mise à jour des afficheurs 3D : LCD du générateur,
                      voltmètre, ampèremètre, fenêtres de la boîte à
                      décades, rotation des boutons, voyant, aiguille.
   ===================================================================== */
import { S, ctx } from './state.js';
import { drawLCD } from './textures.js';

export function updateDisplays() {
    const { genLCD, voltLCD, ammLCD, dialKnobs, genLEDmat, voltKnob } = ctx;

    if (!genLCD) return;

    /* ---- générateur ---- */
    if (S.faultShort) {
        drawLCD(genLCD, 'SC !!', 'PROTECTION', '#ff8a7a');
    } else if (S.genOn) {
        drawLCD(genLCD, S.setV.toFixed(2), 'VOLTS ⎓', '#ffd98a');
    } else {
        drawLCD(genLCD, '−−.−−', 'OFF', 'rgba(125,150,140,.5)');
    }

    /* ---- voltmètre / ampèremètre ---- */
    if (voltLCD) drawLCD(voltLCD, S.faultShort ? '0.00' : S.UV.toFixed(2), 'VOLTS', '#7dffd8');
    if (ammLCD) {
        const iaDisp = Math.abs(S.IA) < 1e-4 ? 0 : S.IA;
        if (S.overload) drawLCD(ammLCD, ' O L', 'SURCHARGE', '#ff8a7a');
        else drawLCD(ammLCD, (iaDisp * 1000).toFixed(1), 'mA', '#7dffd8');
    }

    /* ---- boîte à décades : tambours chiffrés MÉCANIQUES (pas d'écran) ---- */
    drawDrums(S.digits);

    if (genLEDmat) genLEDmat.emissiveIntensity = S.genOn ? 2.2 : 0;
    if (voltKnob) voltKnob.rotation.z = -((S.setV / 15) * 1.5 * Math.PI - .75 * Math.PI);

    (dialKnobs || []).forEach((d, i) => {
        d.rotation.z = -S.digits[i] * (Math.PI * 2 / 10);
        d.userData.tip = `Décade ${['×1000', '×100', '×10', '×1'][i]} — clic : +1 · Maj+clic / molette : −1 (Rv = ${S.Rv} Ω)`;
    });
}

/* ------------------------------------------------------------------ */
/*  Animation de l'aiguille du galvanomètre (ressort amorti)           */
/* ------------------------------------------------------------------ */
export const galvo = { angle: 0, vel: 0 };

export function animateGalvo(dt) {
    const pivot = ctx.galvoPivot;
    if (!pivot) return;
    const target = Math.max(-.62, Math.min(.62, Math.tanh(S.Vg / .02) * .62));
    galvo.vel += ((target - galvo.angle) * 26 - galvo.vel * 7) * dt;
    galvo.angle += galvo.vel * dt;
    pivot.rotation.z = -galvo.angle;
}


/* ------------------------------------------------------------------ */
/*  Tambours chiffrés de la boîte à décades                            */
/*                                                                     */
/*  Comme sur une vraie boîte : un cylindre ivoire tourne derrière une  */
/*  fenêtre, on voit le chiffre du milieu et un bout des deux voisins.  */
/* ------------------------------------------------------------------ */
export function drawDrums(digits) {
    const wins = ctx.digitWins || [];
    wins.forEach((d, i) => {
        const { ctx: c2, tex } = d;
        if (!c2 || !c2.canvas) return;
        const W = c2.canvas.width, H = c2.canvas.height;
        const cur = ((digits && digits[i]) || 0) % 10;
        const prev = (cur + 9) % 10, next = (cur + 1) % 10;

        /* fond : tambour ivoire légèrement bombé */
        const g = c2.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#8d8468'); g.addColorStop(.18, '#ded5b6');
        g.addColorStop(.5, '#f6f0da'); g.addColorStop(.82, '#ded5b6');
        g.addColorStop(1, '#8d8468');
        c2.fillStyle = g; c2.fillRect(0, 0, W, H);

        /* chiffres gravés : voisin du haut, chiffre courant, voisin du bas */
        c2.textAlign = 'center'; c2.textBaseline = 'middle';
        c2.fillStyle = 'rgba(40,36,26,.45)';
        c2.font = '700 ' + (H * .34 | 0) + 'px "JetBrains Mono",monospace';
        c2.fillText(String(prev), W / 2, H * .12);
        c2.fillText(String(next), W / 2, H * .88);
        c2.fillStyle = '#1d1a12';
        c2.font = '700 ' + (H * .52 | 0) + 'px "JetBrains Mono",monospace';
        c2.fillText(String(cur), W / 2, H / 2 + 1);

        /* trait de lecture rouge + ombres de la fenêtre */
        c2.strokeStyle = '#c0392b'; c2.lineWidth = 2;
        c2.beginPath(); c2.moveTo(2, H / 2); c2.lineTo(10, H / 2); c2.stroke();
        c2.beginPath(); c2.moveTo(W - 10, H / 2); c2.lineTo(W - 2, H / 2); c2.stroke();
        c2.fillStyle = 'rgba(0,0,0,.32)'; c2.fillRect(0, 0, W, 5); c2.fillRect(0, H - 5, W, 5);
        c2.strokeStyle = 'rgba(0,0,0,.55)'; c2.lineWidth = 4; c2.strokeRect(2, 2, W - 4, H - 4);
        tex.needsUpdate = true;
    });
}
