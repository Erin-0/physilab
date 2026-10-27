#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
 LaboPhysique 3D  —  Serveur local (statique + relais multijoueur)
================================================================================
 Un SEUL fichier, AUCUNE dépendance externe (stdlib Python uniquement).

 Ce serveur fait deux choses :
   1. Il sert le jeu (index.html, css/, js/) sur http://localhost:PORT
   2. Il relaie l'état des joueurs entre les onglets/fenêtres connectés
      (positions, rotations, accroupissement, zoom, chat, coups, frappes).

 Une "salle" = un port. Deux ports différents sur la même machine
 => deux salles indépendantes (pratique pour faire deux groupes d'élèves).

 USAGE
 -----
     python3 server.py                 # salle par défaut sur le port 8000
     python3 server.py --port 8001     # seconde salle sur le port 8001
     python3 server.py --port 8000 --host 0.0.0.0 --name "Salle A"

 Puis, dans deux fenêtres du navigateur :
     http://localhost:8000/?nom=Alice
     http://localhost:8000/?nom=Bob        (ou simplement http://localhost:8000)

 TRANSPORTS
 ----------
   * WebSocket  (chemin /ws)   : temps réel, utilisé par défaut.
   * Long-polling HTTP (/tx)   : repli automatique si le WebSocket est bloqué
                                 (proxy scolaire, iframe restrictive…).
 Les deux parlent exactement le même protocole JSON, donc le client ne
 change rien à sa logique.
================================================================================
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import secrets
import signal
import struct
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# --------------------------------------------------------------------------- #
#  Configuration
# --------------------------------------------------------------------------- #
ROOT = Path(__file__).resolve().parent
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"      # RFC 6455 magic string
MAX_MSG = 64 * 1024                                    # 64 ko par message
PEER_TTL = 9.0                                         # s sans signe de vie -> expulsé
SWEEP_EVERY = 2.0                                      # fréquence du ménage
ROOMS: "dict[int, Room]" = {}                          # port -> salle

# Un seul fichier est servi tel quel, pas d'accès hors du dossier du jeu.
INDEX = ROOT / "index.html"


# --------------------------------------------------------------------------- #
#  Salle (un port = une salle = une liste de pairs)
# --------------------------------------------------------------------------- #
class Peer:
    """Un joueur connecté (WebSocket ou long-polling)."""

    __slots__ = ("pid", "name", "color", "transport", "state", "chat",
                 "last", "writer", "alive", "ws", "ws_send")

    def __init__(self, pid: str, name: str, color: str, transport: str):
        self.pid = pid
        self.name = name
        self.color = color
        self.transport = transport          # 'ws' | 'poll'
        self.state: dict = {}               # dernier état 3D reçu du client
        self.chat: list = []                # file d'attente pour le long-polling
        self.last = time.time()
        self.writer = None                  # asyncio.StreamWriter (ws)
        self.alive = True
        self.ws = None                      # WebSocketHandler
        self.ws_send = None                 # fonction d'envoi (posée à la volée)

    # -- sérialisation ------------------------------------------------------ #
    def public(self) -> dict:
        return {
            "id": self.pid,
            "name": self.name,
            "color": self.color,
            "transport": self.transport,
            "state": self.state,
        }


class Room:
    def __init__(self, port: int, name: str):
        self.port = port
        self.name = name
        self.peers: "dict[str, Peer]" = {}
        self.created = time.time()
        self.msg_in = 0
        self.msg_out = 0

    # -- présence ----------------------------------------------------------- #
    def add(self, peer: Peer) -> None:
        self.peers[peer.pid] = peer
        print(f"  [+] {peer.name or peer.pid}  ({peer.transport})  "
              f"-> {len(self.peers)} joueur(s) dans « {self.name} »")

    def remove(self, pid: str) -> None:
        p = self.peers.pop(pid, None)
        if not p:
            return
        p.alive = False
        print(f"  [-] {p.name or pid}  -> {len(self.peers)} joueur(s)")
        self.broadcast({"t": "leave", "id": pid}, skip=pid)

    # -- diffusion ---------------------------------------------------------- #
    def broadcast(self, msg: dict, skip: "str | None" = None) -> None:
        payload = json.dumps(msg, separators=(",", ":"))
        for peer in list(self.peers.values()):
            if peer.pid == skip or not peer.alive:
                continue
            if peer.transport == "ws":
                peer.ws_send(payload)
            else:
                peer.chat.append(payload)
                if len(peer.chat) > 240:          # garde-fou mémoire
                    del peer.chat[: len(peer.chat) - 240]
            self.msg_out += 1

    def send_to(self, pid: str, msg: dict) -> None:
        peer = self.peers.get(pid)
        if not peer or not peer.alive:
            return
        payload = json.dumps(msg, separators=(",", ":"))
        if peer.transport == "ws":
            peer.ws_send(payload)
        else:
            peer.chat.append(payload)
        self.msg_out += 1

    # -- relais des messages client ----------------------------------------- #
    def handle(self, sender: Peer, msg: dict) -> None:
        t = msg.get("t")
        sender.last = time.time()
        self.msg_in += 1

        if t == "st":                      # état 3D (position / rotation / …)
            st = msg.get("s")
            if isinstance(st, dict):
                st = _clamp_state(st)
                sender.state = st
                self.broadcast({"t": "st", "id": sender.pid, "s": st}, skip=sender.pid)

        elif t == "chat":                  # message de chat -> bulle au-dessus
            text = str(msg.get("m", ""))[:220].strip()
            if text:
                self.broadcast({"t": "chat", "id": sender.pid,
                                "name": sender.name, "m": text})

        elif t == "punch":                 # le frappeur annonce son geste
            self.broadcast({"t": "punch", "id": sender.pid}, skip=sender.pid)

        elif t == "hit":                   # la victime encaisse
            target = str(msg.get("to", ""))
            if target in self.peers:
                self.send_to(target, {"t": "hit", "from": sender.pid,
                                      "fromName": sender.name,
                                      "f": _num(msg.get("f"), 3.4, 0, 12),
                                      "dx": _num(msg.get("dx"), 0, -1, 1),
                                      "dz": _num(msg.get("dz"), 0, -1, 1)})

        elif t == "bye":
            self.remove(sender.pid)

        elif t == "ping":
            self.send_to(sender.pid, {"t": "pong", "k": msg.get("k")})

        elif t == "hello":                 # (long-polling) re-bonjour
            sender.name = _clean_name(msg.get("name")) or sender.name
            sender.color = str(msg.get("color") or sender.color)[:9]
            self.broadcast({"t": "join", "p": sender.public()}, skip=sender.pid)

    # -- ménage ------------------------------------------------------------- #
    def sweep(self) -> None:
        now = time.time()
        for pid in list(self.peers):
            if now - self.peers[pid].last > PEER_TTL:
                print(f"  [~] {pid} expiré (plus de signe de vie)")
                self.remove(pid)

    def stats(self) -> dict:
        return {
            "room": self.name,
            "port": self.port,
            "players": len(self.peers),
            "uptime": round(time.time() - self.created, 1),
            "in": self.msg_in,
            "out": self.msg_out,
            "who": [p.public() for p in self.peers.values()],
        }


# --------------------------------------------------------------------------- #
#  Petits utilitaires de validation (on ne fait jamais confiance au client)
# --------------------------------------------------------------------------- #
def _num(v, default=0.0, lo=-1e6, hi=1e6) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f:                              # NaN
        return default
    return max(lo, min(hi, f))


def _clamp_state(s: dict) -> dict:
    """Bornage de l'état 3D : évite les NaN / valeurs absurdes dans le relais."""
    out = {
        "x": _num(s.get("x"), 0, -60, 60),
        "y": _num(s.get("y"), 1.6, -5, 20),
        "yaw": _num(s.get("yaw"), 0, -100, 100),
        "pitch": _num(s.get("pitch"), 0, -3, 3),
        "crouch": 1 if s.get("crouch") else 0,
        "zoom": 1 if s.get("zoom") else 0,
        "punch": _num(s.get("punch"), 0, 0, 1),
        "hurt": _num(s.get("hurt"), 0, 0, 1),
        "bob": _num(s.get("bob"), 0, -10, 10),
        "lvl": str(s.get("lvl") or "A")[:2],
    }
    return out


def _clean_name(v) -> str:
    s = "".join(ch for ch in str(v or "") if ch.isprintable() and ch not in "<>&\"")
    return s.strip()[:18]


# --------------------------------------------------------------------------- #
#  WebSocket (RFC 6455) — implémentation minimale sur asyncio
# --------------------------------------------------------------------------- #
def ws_accept_key(key: str) -> str:
    return base64.b64encode(hashlib.sha1((key.strip() + WS_GUID).encode()).digest()).decode()


def ws_encode(payload: str, opcode: int = 0x1) -> bytes:
    data = payload.encode("utf-8") if isinstance(payload, str) else payload
    n = len(data)
    head = bytearray([0x80 | opcode])
    if n < 126:
        head.append(n)
    elif n < 65536:
        head.append(126)
        head += struct.pack(">H", n)
    else:
        head.append(127)
        head += struct.pack(">Q", n)
    return bytes(head) + data


class WSConn:
    """Lecture/écriture d'une connexion WebSocket sur un StreamReader."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self.reader = reader
        self.writer = writer
        self.closed = False
        self._frag = bytearray()
        self._frag_opcode = 0

    async def recv(self) -> "str | None":
        """Renvoie le prochain message texte, ou None si la connexion tombe."""
        while True:
            b1 = await self.reader.readexactly(1)
            b2 = await self.reader.readexactly(1)
            fin = b1[0] & 0x80
            opcode = b1[0] & 0x0F
            masked = b2[0] & 0x80
            ln = b2[0] & 0x7F
            if ln == 126:
                ln = struct.unpack(">H", await self.reader.readexactly(2))[0]
            elif ln == 127:
                ln = struct.unpack(">Q", await self.reader.readexactly(8))[0]
            if ln > MAX_MSG:
                raise ValueError("message trop volumineux")
            mask = await self.reader.readexactly(4) if masked else b""
            data = await self.reader.readexactly(ln) if ln else b""
            if masked:
                data = bytes(c ^ mask[i & 3] for i, c in enumerate(data))

            if opcode == 0x8:                                   # close
                return None
            if opcode == 0x9:                                   # ping -> pong
                await self.raw(ws_encode(data, 0xA))
                continue
            if opcode == 0xA:                                   # pong
                continue

            if opcode == 0x0:                                   # continuation
                self._frag += data
            else:
                self._frag_opcode = opcode
                self._frag = bytearray(data)

            if fin:
                msg = bytes(self._frag)
                self._frag.clear()
                if self._frag_opcode == 0x1:
                    return msg.decode("utf-8", "replace")
                # binaire : non utilisé par le jeu
        return None

    async def raw(self, data: bytes) -> None:
        if self.closed:
            return
        self.writer.write(data)
        try:
            await self.writer.drain()
        except (ConnectionResetError, BrokenPipeError):
            self.closed = True

    async def send(self, text: str) -> None:
        await self.raw(ws_encode(text, 0x1))

    def close(self) -> None:
        self.closed = True
        try:
            self.writer.close()
        except Exception:
            pass


async def ws_handshake(reader, writer, headers) -> bool:
    key = headers.get("sec-websocket-key")
    if not key:
        writer.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
        await writer.drain()
        return False
    resp = (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {ws_accept_key(key)}\r\n\r\n"
    )
    writer.write(resp.encode())
    await writer.drain()
    return True


# --------------------------------------------------------------------------- #
#  Serveur HTTP + WS
# --------------------------------------------------------------------------- #
class Server:
    def __init__(self, port: int, room_name: str):
        self.port = port
        self.room = Room(port, room_name)
        ROOMS[port] = self.room

    # ------------------------------------------------------------------ #
    async def handle_conn(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            request_line = await asyncio.wait_for(reader.readline(), 15)
        except (asyncio.TimeoutError, ConnectionResetError):
            writer.close()
            return
        if not request_line:
            writer.close()
            return
        try:
            method, target, _ver = request_line.decode("latin-1").split(" ", 2)
        except ValueError:
            writer.close()
            return

        headers = {}
        while True:
            line = await reader.readline()
            if line in (b"\r\n", b"\n", b""):
                break
            if b":" in line:
                k, v = line.decode("latin-1").split(":", 1)
                headers[k.strip().lower()] = v.strip()

        url = urlparse(target)
        path = url.path or "/"
        query = parse_qs(url.query)

        try:
            if "upgrade" in headers.get("connection", "").lower() and path == "/ws":
                if await ws_handshake(reader, writer, headers):
                    await self.ws_session(reader, writer, query)
                return
            if method == "GET":
                await self.http_get(writer, path, query)
            elif method == "POST":
                await self.http_post(reader, writer, path, headers, query)
            elif method == "OPTIONS":
                await self._send(writer, 204, b"", "text/plain",
                                 extra={"Access-Control-Allow-Origin": "*",
                                        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
                                        "Access-Control-Allow-Headers": "Content-Type"})
            else:
                await self._send(writer, 405, b"405 Method Not Allowed", "text/plain")
        except (ConnectionResetError, BrokenPipeError, asyncio.IncompleteReadError):
            pass
        except Exception as exc:                       # ne jamais tuer le serveur
            print(f"  [!] erreur requête : {exc!r}")
            try:
                await self._send(writer, 500, b"500 Internal Server Error", "text/plain")
            except Exception:
                pass
        finally:
            try:
                if not writer.is_closing():
                    writer.close()
            except Exception:
                pass

    # ------------------------------------------------------------------ #
    #  WebSocket : session de jeu
    # ------------------------------------------------------------------ #
    async def ws_session(self, reader, writer, query):
        conn = WSConn(reader, writer)
        peer = Peer(secrets.token_hex(4),
                    _clean_name(query.get("nom", query.get("name", [""]))[0]),
                    "#22d3ee", "ws")
        peer.ws = conn
        peer.writer = writer

        def ws_send(payload: str) -> None:
            if peer.alive and not conn.closed:
                asyncio.ensure_future(conn.send(payload))
        peer.ws_send = ws_send                      # type: ignore[attr-defined]

        self.room.add(peer)
        await conn.send(json.dumps({
            "t": "ok", "id": peer.pid,
            "peers": [p.public() for k, p in self.room.peers.items() if k != peer.pid],
            "room": self.room.name,
        }, separators=(",", ":")))
        self.room.broadcast({"t": "join", "p": peer.public()}, skip=peer.pid)

        try:
            while True:
                raw = await conn.recv()
                if raw is None:
                    break
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(msg, dict):
                    if msg.get("t") == "hello":
                        peer.name = _clean_name(msg.get("name")) or peer.name
                        peer.color = str(msg.get("color") or peer.color)[:9]
                        self.room.broadcast({"t": "join", "p": peer.public()}, skip=peer.pid)
                    self.room.handle(peer, msg)
        except (asyncio.IncompleteReadError, ConnectionResetError, ValueError, OSError):
            pass
        finally:
            self.room.remove(peer.pid)
            conn.close()

    # ------------------------------------------------------------------ #
    #  Long-polling de secours :  POST /tx  (envoi)   GET /tx (réception)
    # ------------------------------------------------------------------ #
    async def http_post(self, reader, writer, path, headers, query):
        length = int(headers.get("content-length", "0") or 0)
        body = await reader.readexactly(length) if length else b""

        if path == "/tx":
            try:
                msg = json.loads(body.decode("utf-8", "replace") or "{}")
            except json.JSONDecodeError:
                await self._json(writer, 400, {"ok": False})
                return
            pid = str(msg.get("id") or "")[:32]
            if not pid:
                await self._json(writer, 400, {"ok": False, "e": "id manquant"})
                return
            peer = self.room.peers.get(pid)
            if peer is None or peer.transport != "poll":
                # (re)inscription du joueur en mode polling
                peer = Peer(pid, _clean_name(msg.get("name")),
                            str(msg.get("color") or "#22d3ee")[:9], "poll")
                self.room.add(peer)
                await self._json(writer, 200, {
                    "ok": True, "new": True,
                    "peers": [p.public() for k, p in self.room.peers.items() if k != pid],
                    "room": self.room.name,
                })
                return
            inner = msg.get("m")
            if isinstance(inner, dict):
                self.room.handle(peer, inner)
            elif isinstance(inner, list):
                for it in inner:
                    if isinstance(it, dict):
                        self.room.handle(peer, it)
            peer.last = time.time()
            await self._json(writer, 200, {"ok": True})
            return

        await self._json(writer, 404, {"ok": False, "e": "route inconnue"})

    async def http_get(self, writer, path, query):
        if path in ("/", "/index.html"):
            data = INDEX.read_bytes()
            await self._send(writer, 200, data, "text/html; charset=utf-8")
            return

        if path == "/status":
            await self._json(writer, 200, {"ok": True, **self.room.stats()})
            return

        if path == "/tx":
            pid = (query.get("id", [""])[0] or "")[:32]
            peer = self.room.peers.get(pid)
            out = []
            if peer is not None and peer.transport == "poll":
                peer.last = time.time()
                out, peer.chat = peer.chat, []
            # état complet des joueurs WebSocket (les pollers sont poussés via out)
            ws_states = [p.public() for p in self.room.peers.values()
                         if p.transport == "ws" and p.pid != pid]
            await self._json(writer, 200, {
                "ok": True, "q": out, "ws": ws_states,
                "room": self.room.name, "players": len(self.room.peers),
            })
            return

        # ---- fichiers statiques ---- #
        rel = path.lstrip("/")
        fpath = (ROOT / rel).resolve()
        try:
            fpath.relative_to(ROOT)
        except ValueError:
            await self._send(writer, 403, b"403 Forbidden", "text/plain")
            return
        if fpath.is_dir():
            fpath = fpath / "index.html"
        if not fpath.is_file():
            await self._send(writer, 404, self._not_found(rel), "text/html; charset=utf-8")
            return
        ctype, _ = mimetypes.guess_type(str(fpath))
        ctype = ctype or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        data = fpath.read_bytes()
        await self._send(writer, 200, data, ctype,
                         extra={"Cache-Control": "no-store"})

    # ------------------------------------------------------------------ #
    def _not_found(self, rel: str) -> bytes:
        return (
            "<!doctype html><meta charset=utf-8><title>404</title>"
            "<body style='background:#05060a;color:#e5eaf3;font-family:system-ui;"
            "padding:40px'><h1>404 — fichier introuvable</h1>"
            f"<p><code>{rel}</code></p><p>Dossier du jeu : <code>{ROOT}</code></p>"
            "</body>"
        ).encode()

    async def _json(self, writer, code: int, obj: dict) -> None:
        await self._send(writer, code, json.dumps(obj, separators=(",", ":")).encode(),
                         "application/json; charset=utf-8")

    async def _send(self, writer, code: int, data: bytes, ctype: str, extra=None) -> None:
        reason = {200: "OK", 204: "No Content", 400: "Bad Request", 403: "Forbidden",
                  404: "Not Found", 405: "Method Not Allowed",
                  500: "Internal Server Error"}.get(code, "OK")
        head = [f"HTTP/1.1 {code} {reason}",
                f"Content-Type: {ctype}",
                f"Content-Length: {len(data)}",
                "Connection: close",
                "Access-Control-Allow-Origin: *"]
        for k, v in (extra or {}).items():
            head.append(f"{k}: {v}")
        writer.write(("\r\n".join(head) + "\r\n\r\n").encode("latin-1"))
        if data:
            writer.write(data)
        try:
            await writer.drain()
        except (ConnectionResetError, BrokenPipeError):
            pass

    # ------------------------------------------------------------------ #
    async def sweeper(self) -> None:
        while True:
            await asyncio.sleep(SWEEP_EVERY)
            self.room.sweep()

    async def serve(self, host: str) -> None:
        srv = await asyncio.start_server(self.handle_conn, host, self.port)
        task = asyncio.ensure_future(self.sweeper())
        socks = ", ".join(f"http://{s.getsockname()[0]}:{s.getsockname()[1]}"
                          for s in srv.sockets)
        print("=" * 72)
        print(f"  LaboPhysique 3D — serveur local")
        print(f"  Salle : « {self.room.name} »   (port {self.port})")
        print("-" * 72)
        print(f"  Solo (défaut) :  http://localhost:{self.port}/")
        print("                   aucun personnage, aucun serveur utilisé par le client")
        print(f"  Joueur 1 :  http://localhost:{self.port}/?nom=Alice")
        print(f"  Joueur 2 :  http://localhost:{self.port}/?nom=Bob")
        print(f"  État    :  {socks}/status")
        print("-" * 72)
        print("  Une salle = un port. Pour une 2e salle indépendante :")
        print(f"      python3 server.py --port {self.port + 1} --name \"Salle B\"")
        print("  Arrêt : Ctrl+C")
        print("=" * 72, flush=True)
        async with srv:
            await srv.serve_forever()


# --------------------------------------------------------------------------- #
#  Point d'entrée
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(description="Serveur local LaboPhysique 3D")
    ap.add_argument("--port", "-p", type=int, default=8000, help="port d'écoute (défaut 8000)")
    ap.add_argument("--host", default="0.0.0.0", help="interface (défaut 0.0.0.0)")
    ap.add_argument("--name", "-n", default="TP Résistances", help="nom de la salle")
    args = ap.parse_args()

    if not INDEX.is_file():
        print(f"[ERREUR] index.html introuvable dans {ROOT}", file=sys.stderr)
        sys.exit(1)

    srv = Server(args.port, args.name)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    async def _run():
        try:
            await srv.serve(args.host)
        except asyncio.CancelledError:
            pass

    task = loop.create_task(_run())

    def _stop(*_a):
        print("\n  Arrêt du serveur… au revoir !", flush=True)
        task.cancel()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _stop)
        except NotImplementedError:
            pass
    try:
        loop.run_until_complete(task)
    except (KeyboardInterrupt, SystemExit, asyncio.CancelledError):
        pass
    except OSError as exc:
        print(f"[ERREUR] port {args.port} indisponible : {exc}", file=sys.stderr)
        sys.exit(1)
    except RuntimeError:
        pass                      # boucle interrompue par un signal : arrêt propre
    finally:
        # On annule tout ce qui reste (connexions clients, tâches internes),
        # puis on laisse la boucle traiter ces annulations avant de fermer :
        # plus aucune trace d'erreur à l'écran au Ctrl+C.
        pending = [t for t in asyncio.all_tasks(loop) if not t.done()]
        for t in pending:
            t.cancel()
        if pending:
            try:
                loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
            except (RuntimeError, KeyboardInterrupt, SystemExit):
                pass
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except (RuntimeError, KeyboardInterrupt, SystemExit):
            pass
        try:
            loop.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
