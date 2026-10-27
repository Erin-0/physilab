# LaboPhysique 3D — TP « Mesure de Résistances »

Laboratoire de physique en 3D (Three.js), jouable **en solo** (par défaut, sans
personnage ni serveur) ou **en multijoueur local** via un **serveur Python sans
aucune dépendance externe**.

Deux postes de travail :

* une **paillasse circulaire** au centre de la pièce, avec les appareils disposés
  **autour**, face avant tournée vers le centre (il faut en faire le tour pour lire
  les écrans) — seule la carte du pont de Wheatstone reste posée à plat au milieu ;
* un **bureau carré à droite** portant la feuille lignée **« Relevés de laboratoire »**
  et son **stylo noir** : un clic gauche dessus sort une **nouvelle feuille vierge**
  (fenêtre « papier », police manuscrite) avec un tableau **vide à remplir à la main**.

Les appareils se **déplacent** à l'appui long, se **tournent** à la molette, et
**ne tombent jamais** : lâchés au-dessus du vide, ils reviennent se poser sur le
mobilier.

---

## 1. Démarrer

### Solo (par défaut)

```bash
cd labo3d
python3 server.py            # sert simplement les fichiers (aucun relais utilisé)
```

Puis ouvrez <http://localhost:8000/> — ou directement le bouton **« Solo »** de
l'écran d'accueil. **Aucun personnage** n'est créé, **aucun serveur** n'est
contacté par le client, **aucun ami** n'apparaît : le laboratoire est à vous.
L'URL <http://localhost:8000/?solo=0> force le mode à deux.

### À deux (multijoueur local)

| Joueur | Adresse |
| ------ | ------- |
| 1 | <http://localhost:8000/?nom=Alice> |
| 2 | <http://localhost:8000/?nom=Bob> |

Un `?nom=` dans l'adresse bascule automatiquement en mode **À deux**.

**Une salle = un port.** Pour deux salles indépendantes sur la même machine :

```bash
python3 server.py --port 8000 --name "Salle A"
python3 server.py --port 8001 --name "Salle B"     # second terminal
```

Options : `--port/-p`, `--host`, `--name/-n`.
État de la salle en JSON : <http://localhost:8000/status>.

> Le client tente d'abord le **WebSocket** (`/ws`) ; s'il est bloqué (proxy, iframe
> restrictive), il bascule **automatiquement** en long-polling HTTP (`/tx`) avec le
> même protocole. La pastille en haut à droite indique `EN LIGNE` (WS) ou
> `SECOURS` (polling) ou `SOLO` (aucun serveur, par ex. ouverture en `file://`).

---

## 2. Arborescence

```
labo3d/
├── index.html              structure + HUD (aucun style en ligne)
├── server.py               serveur statique + relais multijoueur (stdlib uniquement)
├── css/
│   └── style.css           verre dépoli, viseur, feuille « papier », chat, avatar
├── js/
│   ├── main.js             orchestrateur : montage des modules, boucle de rendu
│   ├── state.js            état de simulation S, presets, registres partagés, ctx
│   ├── audio.js            synthétiseur Web Audio (clics, clacs, chute, chat, coup)
│   ├── textures.js         textures procédurales + LCD + sprites (noms, bulles)
│   ├── environment.js      pièce, table RONDE, bureau, papier, stylo, lumières
│   ├── instruments.js      générateur, multimètres, bloc R, décades, galvano, pont
│   ├── wiring.js           fils bananes (chaînette), aperçu, débranchement auto
│   ├── circuit.js          union-find + analyse nodale (MNA), objectifs du TP
│   ├── displays.js         LCD, décades, voyant, aiguille du galvanomètre
│   ├── hud.js              toasts, pastilles, objectifs, FEUILLE DE RELEVÉS, chat
│   ├── drag.js             appui long → déplacement + ROTATION (molette), sans chute
│   ├── quality.js          presets graphiques appliqués à chaud
│   ├── lighting.js         ambiances d'éclairage + curseur d'intensité
│   ├── player.js           FPS : pointer lock, ZQSD/WASD, collisions, zoom, coups
│   ├── avatar.js           personnages simples (yeux, bouche, sans bras ni jambes)
│   └── net.js              client WebSocket + repli long-polling
└── tests/
    ├── run_tests.py        lance les 4 suites headless (101 assertions)
    ├── test_circuit.mjs    solveur électrique (30)
    ├── test_env.mjs        surfaces d'appui : table ronde / bureau / sol (7)
    ├── test_scene.mjs      scène, disposition, tailles, APLOMB, éclairage (25)
    ├── test_boot.mjs       exécute le vrai js/main.js sur un DOM factice (39)
    ├── test_server.py      serveur de bout en bout : HTTP, WebSocket, relais (20)
    ├── extents.mjs         mesure l'encombrement réel d'un objet 3D (aplomb)
    ├── domstub.mjs         DOM/canvas/localStorage/WebSocket factices
    └── three-stub/         module « three » minimal pour Node (aucun npm install)
```

Dépendances côté navigateur (CDN, chargées par `index.html`) : Three.js 0.160,
Lucide (icônes), polices Space Grotesk / JetBrains Mono / Caveat.
Côté serveur : **Python 3.8+ standard, rien à installer**.

---

## 3. Contrôles

| Action | Commande |
| ------ | -------- |
| Se déplacer autour de la paillasse | `Z Q S D` / `W A S D` / flèches |
| Regarder | souris (pointer lock) |
| Loupe (zoom ×2,6) | `E`, ou molette **quand aucun objet n'est saisi** |
| Se pencher / s'accroupir | `Ctrl` |
| Câbler | clic sur une borne, puis clic sur une autre |
| Annuler un fil en cours / retirer un fil | clic droit / clic sur le fil |
| Régler un bouton ou une décade | molette ou `Maj` + clic (sinon clic simple) |
| **Déplacer un appareil, la feuille ou le stylo** | **appui long (~0,3 s) puis viser** |
| **Faire tourner l'objet saisi** | **molette** (7,5° par cran) |
| **Rotation rapide de l'objet saisi** | **bouton droit maintenu** + molette (×3,7) |
| Prendre une **nouvelle feuille** de relevés | clic gauche sur le **papier** ou le **stylo** |
| Régler l'**éclairage** de la salle | bouton **soleil** en bas à droite |
| Niveau A / niveau B | `1` / `2` (ou onglets en haut à gauche) |
| **Parler aux autres élèves** | `Entrée`, puis `Entrée` pour envoyer |
| **Frapper un autre élève** | clic gauche sur sa figurine (à moins de 2 m) |
| Remettre les appareils à leur place | `Maj` + `R` |
| Libérer la souris | `Échap` |

Le panneau « raccourcis clavier » a été **supprimé** de l'interface : les aides
contextuelles (infobulle au centre, pastille « cible » en haut à droite, messages)
suffisent, et l'écran d'accueil récapitule l'essentiel.

---

## 4. Ce que cette mise à jour ajoute

### Appareils : plus grands, et conformes au matériel réel
* Tous les instruments sont dessinés à leur **taille réelle** puis multipliés par
  `INSTR_SCALE = 1,18` (`js/state.js`) : ils sont un peu plus gros pour rester
  lisibles, mais **leurs proportions entre eux et avec la paillasse sont conservées**
  — on reconnaît immédiatement l'échelle d'un vrai laboratoire.
  Le plus grand (la boîte à décades, 61 × 35 cm) reste plus petit que la table.
* Leur **aplomb est mesuré, pas deviné** : `placeDevice()` calcule la boîte
  englobante de l'appareil (`Box3`) et le pose pour que le dessous de ses pieds
  caoutchouc affleure le plateau (jeu de 1 mm). Un test vérifie chaque objet au
  millimètre.
* Modélisation rapprochée du matériel de TP qu'on trouve réellement sur une paillasse :
  * **alimentation stabilisée 0–15 V / 2 A** : poignée de transport, pieds caoutchouc,
    grille d'aération, afficheur, bouton « TENSION » cranté avec graduations imprimées,
    interrupteur M/A à bascule avec voyant, douilles bananes 4 mm rouge/noire ;
  * **multimètres numériques autoranging** : étui de protection jaune, grand afficheur,
    sélecteur rotatif de fonction, douilles `COM` / `V Ω mA` ;
  * **boîte de résistance bobinée** : plaque bakélite inclinée, résistance de puissance
    sur barreau céramique avec code de couleurs, chapes métalliques, douilles A/B ;
  * **boîte à résistances à décades** : boîtier bakélite, **tambours chiffrés
    mécaniques** (plus d'écran : on voit le chiffre et ses deux voisins, avec le trait
    de lecture rouge), quatre boutons crantés ×1000 ×100 ×10 ×1, bornes A/B ;
  * **galvanomètre à zéro central** : boîtier crème sur socle bakélite, échelle gravée,
    **bande de miroir anti-parallaxe**, vitre, aiguille rouge, réglage du zéro ;
  * **pont de Wheatstone** : circuit imprimé vert, sérigraphie blanche, quatre
    résistances à code de couleurs posées sur les bras du losange, réglette laiton
    avec curseur, douilles P+/P−/M1/M2.

### Rotation libre des appareils
* Objet saisi → **molette** : rotation de 7,5° par cran, dans le sens du geste.
* **Bouton droit maintenu** pendant la saisie : rotation **rapide** (×3,7) — l'anneau
  de sélection passe à l'ambre et tourne plus vite pour le signaler.
* L'orientation choisie est **conservée** à la pose : les appareils ne se remettent
  plus tous face au centre (seule leur orientation *initiale* reste tournée vers le
  milieu de la paillasse).

### Plus aucun objet qui tombe
* La physique de chute (gravité, rebonds, rotation en l'air) a été **supprimée**.
* Pendant le déplacement, un objet **glisse jusqu'au bord** du support puis s'arrête ;
  lâché au-dessus du vide, il **revient se poser** sur la paillasse ou le bureau.
* La stabilité est vérifiée « comme en vrai » : le centre de gravité doit porter, et
  au moins 5 des 8 points de l'empreinte au sol — un appareil ne tient donc pas en
  équilibre sur un coin, mais on peut le tourner de travers sans qu'il saute.

### Feuille de relevés
* Un clic sur le **papier** ou le **stylo** sort une **nouvelle feuille vierge**
  (petit geste « on tourne la page » en 3D + animation de la fenêtre).
* Les relevés déjà écrits ne sont pas perdus : bouton **« Feuille précédente »**
  (apparaît dès qu'une feuille est en réserve) et bouton **« Nouvelle feuille »**.

### Éclairage réglable, sans encombrer l'écran
* Un **unique petit bouton « soleil »** dans la barre Qualité ouvre un volet discret :
  4 ambiances (**Veillée**, **Atelier**, **Lumineux**, **Plein jour**) et un curseur
  d'intensité (70 % → 150 %). Un clic ailleurs referme le volet.
* Le réglage agit sur l'exposition du rendu, l'hémisphérique, le spot de la paillasse,
  les deux lumières d'ambiance, la lampe du bureau, la brillance des néons et la
  densité de la brume. Choix **mémorisé** entre deux sessions.

### Mode solo
* Choix du mode sur l'écran d'accueil : **Solo** (par défaut) ou **À deux**.
* En solo : **aucun personnage** n'est créé (ni le vôtre, ni personne), **aucun
  serveur** n'est contacté, **aucun ami** ne peut apparaître ; les pastilles
  « réseau » et « joueurs », le bouton et la barre de chat sont masqués, et la ligne
  prénom/couleur disparaît de l'écran d'accueil.
* Le mode multijoueur reste **intact** (`?nom=Alice`, `?nom=Bob`, deux ports = deux
  salles) : il suffit de choisir « À deux ».

### Poste de travail
* Paillasse **circulaire** centrale (pied colonne, liseré inox, tapis antidérapant).
* Appareils répartis **en couronne**, face avant vers le centre ; la carte du pont
  reste à plat au centre (seule exception, comme demandé).
* **Bureau carré** à droite : feuille lignée « Relevés de laboratoire » + stylo noir,
  tous deux présents en 3D dans le raycast existant (aucune touche dédiée).

### Feuille de relevés
* Fenêtre en **papier** (fond crème, lignes bleues, marge rouge, coin corné),
  police **manuscrite** (Caveat), encre sombre — pas un « écran ».
* Tableau **vide** : n°, Niveau, Montage/Pont, U (V), I (mA), R/Rx (Ω), Heure,
  Observations. On saisit **à la main** ; `R = U/I` se propose tout seul dès que
  U et I sont écrits (et reste modifiable).
* « Recopier la mesure affichée » pré-remplit une ligne depuis les appareils —
  à vérifier ensuite au stylo. Export **CSV** (point-virgule, BOM UTF-8).

### Manipulation des objets
* **Appui long** sur un appareil / la feuille / le stylo : une **icône de sélection**
  (anneau cyan pulsant) apparaît et l'objet suit le regard.
* Tous les **fils branchés sur cet appareil sont débranchés automatiquement**
  au moment de la saisie.
* Relâché au-dessus de la table ou du bureau → il se pose **dans l'orientation
  choisie à la molette**. Relâché **dans le vide** → il revient se poser sur le
  mobilier : **rien ne tombe**.

### Pédagogie
* Le **générateur est toujours livré ÉTEINT et à 0 V** (et il est remis à zéro à
  chaque changement de niveau) : l'élève apprend à l'allumer en premier.
  Régler la tension avant de l'allumer provoque un rappel.

### Multijoueur (serveur Python)
* Projet **mono-fichier éclaté** en 16 modules ES + 1 feuille de style + 1 serveur.
* Deux joueurs (ou plus) sur la même machine via le serveur local, **deux ports =
  deux salles**.
* Chaque joueur voit l'autre : **position, rotation, accroupissement, zoom, coup,
  impact** sont relayés (état publié à 20 Hz, interpolation douce côté récepteur).
* **Messagerie instantanée** : bulle au-dessus du personnage (façon Roblox),
  disparition automatique après ~5 s, plus un toast discret.
* **Coups** : clic sur la figurine d'un autre joueur à moins de 2 m → flash rouge
  sur la victime, recul physique, son d'impact, écran rouge pour celui qui encaisse.
  Impossible de toucher à distance.
* Figurines **volontairement simples** : corps capsule, tête, deux yeux, une bouche,
  un liseré à la couleur du joueur — **ni bras ni jambes**.

---

## 5. Tests

```bash
python3 tests/run_tests.py
```

101 assertions, sans navigateur :

* **solveur électrique** (30) : loi d'Ohm, montages amont/aval, court-circuit,
  surcharge, pont équilibré/déséquilibré, générateur éteint ;
* **surfaces d'appui** (7) : table ronde, bureau tourné, sol ;
* **scène et poste de travail** (25) : tous les appareils rattachés à la scène,
  couronne face au centre, carte du pont à plat, bureau et feuille à droite,
  générateur éteint, **facteur d'agrandissement identique partout**, **tailles
  réalistes** (du plus petit au plus grand), **aplomb mesuré au millimètre**
  (aucun appareil ne flotte ni ne s'enfonce dans le plateau — le test mesure le
  point le plus bas de chaque objet, voir `tests/extents.mjs`), tambours chiffrés
  de la boîte à décades, **lumières pilotables** ;
* **exécution complète du vrai `js/main.js`** (39) sur un DOM factice : registres,
  feuille de relevés manuelle, **nouvelle feuille / feuille précédente**, avatar,
  **rotation à la molette (7,5°) et rotation rapide (×3,7)**, **absence totale de
  chute**, **mode solo** (aucun personnage, aucune connexion), éclairage,
  évaluation du circuit.

Le serveur se teste à part — il démarre tout seul sur un port libre :

```bash
python3 tests/test_server.py     # 20 assertions
```

(statiques et traversée de chemins interdite, poignée de main WebSocket RFC 6455,
relais état/chat/coup entre deux clients, bornage des valeurs aberrantes, départ
d'un joueur, repli long-polling `/tx`, `/status`). Les messages clients sont
systématiquement validés et bornés côté serveur.

---

## 6. Dépannage

| Symptôme | Cause / solution |
| -------- | ---------------- |
| Aucune figurine, aucune pastille réseau | C'est le **mode solo** (par défaut). Bouton « À deux » sur l'écran d'accueil, ou `?nom=Alice`. |
| Pastille `SOLO` alors qu'on veut jouer à deux | Page ouverte en `file://` : passez par `python3 server.py` + <http://localhost:8000/?nom=Alice>. |
| La salle est trop sombre / trop claire | Bouton **soleil** en bas à droite : 4 ambiances + curseur d'intensité. |
| Un appareil ne veut pas rester où je le pose | Il dépasse du plateau : la stabilité exige le centre **et** 5 points d'empreinte sur 8. Rapprochez-le du centre de la paillasse. |
| Pastille `SECOURS` | WebSocket bloqué par un proxy : le jeu reste jouable en long-polling (relevé d'état un peu moins fluide). |
| `port 8000 indisponible` | `python3 server.py --port 8002`. |
| Écran noir / rien ne se charge | Les CDN (Three.js, Lucide, polices) sont injoignables : vérifiez l'accès réseau. |
| La souris ne répond pas | Cliquez dans la vue pour reprendre le pointer lock (`Échap` le libère). |
| Images saccadées | Qualité « Basse » ou « Moyenne » en bas à droite (choix mémorisé). |
