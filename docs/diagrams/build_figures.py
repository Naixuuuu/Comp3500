# -*- coding: utf-8 -*-
"""Generate the system-modelling figures for the Election Management project.

Each figure is built as SVG, wrapped in a minimal HTML page, and rasterised to PNG with
headless Edge at 2x device scale so the text stays sharp in the report and in Markdown.
"""
import os
import subprocess
import sys

OUT = r"E:\HKMU\comp3500sef\project_election\docs\diagrams"
TMP = r"E:\HKMU\comp3500sef\project_election\docs\diagrams\_tmp"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not os.path.exists(EDGE):
    EDGE = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"

NAVY = "#12386b"
BLUE = "#3a6ea8"
GREY = "#6b7891"
LIGHT = "#a8b6c9"
GOLD = "#b8860b"
GREEN = "#2e7d32"
RED = "#c62828"
INK = "#1b2430"
BAND = "#dfe8f5"

FONT = 'font-family="Microsoft YaHei, Segoe UI, Arial, sans-serif"'

DEFS = f'''<defs>
  <marker id="arw" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" fill="{LIGHT}"/></marker>
  <marker id="arw2" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" fill="{BLUE}"/></marker>
  <marker id="arwg" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
    <path d="M0,0 L10,5 L0,10 z" fill="{GOLD}"/></marker>
  <marker id="arwo" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto">
    <path d="M0,0 L12,6 L0,12 z" fill="none" stroke="{BLUE}" stroke-width="1.4"/></marker>
</defs>'''


# ---------------------------------------------------------------- primitives
def txt(x, y, s, size=12, anchor="start", weight="400", color=INK, style=""):
    return (f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" '
            f'font-weight="{weight}" fill="{color}" {FONT} {style}>{s}</text>')


def box(x, y, w, h, fill="#ffffff", stroke=BLUE, sw=1.6, rx=0, dash=""):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{sw}"{d}/>')


def uc(x, y, w, h, label, size=12):
    """Use-case capsule."""
    return (box(x, y, w, h, rx=h // 2) +
            txt(x + w / 2, y + h / 2 + size * 0.36, label, size, "middle", "550", INK))


def actor(x, y, label, size=12):
    """Stick figure with its label beneath; (x, y) is the top of the head circle."""
    s = [f'<g stroke="{NAVY}" stroke-width="1.8" fill="none" stroke-linecap="round">',
         f'<circle cx="{x}" cy="{y + 11}" r="11" fill="#fff"/>',
         f'<line x1="{x}" y1="{y + 22}" x2="{x}" y2="{y + 47}"/>',
         f'<line x1="{x - 17}" y1="{y + 31}" x2="{x + 17}" y2="{y + 31}"/>',
         f'<line x1="{x}" y1="{y + 47}" x2="{x - 13}" y2="{y + 69}"/>',
         f'<line x1="{x}" y1="{y + 47}" x2="{x + 13}" y2="{y + 69}"/>',
         '</g>',
         txt(x, y + 89, label, size, "middle", "650", NAVY)]
    return "".join(s)


def line(pts, stroke=LIGHT, sw=1.5, dash="", marker="", arrow_end=True):
    p = " ".join(f"{a},{b}" for a, b in pts)
    m = f' marker-end="url(#{marker})"' if marker else ""
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<polyline points="{p}" fill="none" stroke="{stroke}" stroke-width="{sw}"'
            f'{d}{m} stroke-linejoin="round"/>')


def note(x, y, w, h, lines, size=10.5):
    fold = 14
    s = [f'<path d="M{x},{y} L{x + w - fold},{y} L{x + w},{y + fold} L{x + w},{y + h} '
         f'L{x},{y + h} Z" fill="#fffdf5" stroke="{GOLD}" stroke-width="1.3"/>',
         f'<path d="M{x + w - fold},{y} L{x + w - fold},{y + fold} L{x + w},{y + fold}" '
         f'fill="none" stroke="{GOLD}" stroke-width="1.3"/>']
    for i, s_ in enumerate(lines):
        s.append(txt(x + 10, y + 19 + i * 15, s_, size, "start", "400", "#5a4a1a"))
    return "".join(s)


def doc(w, h, body, title=None):
    head = ""
    if title:
        head = (f'<text x="26" y="34" font-size="17" font-weight="700" fill="{NAVY}" '
                f'{FONT}>{title}</text>')
    return f'''<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{{margin:0;padding:0;background:#fff;}}
  svg{{display:block;}}
</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}">
{DEFS}
{head}
{body}
</svg></body></html>'''


# ================================================================ FIG 1 context
def fig1():
    W, H = 1520, 900
    s = []
    bx, by, bw, bh = 500, 200, 520, 360
    s.append(box(bx, by, bw, bh, fill="#f4f7fb", stroke=NAVY, sw=2.2, rx=12))
    s.append(txt(bx + bw / 2, by + 52, "Election Management and", 17, "middle", "700", NAVY))
    s.append(txt(bx + bw / 2, by + 78, "Voting System", 17, "middle", "700", NAVY))
    s.append(txt(bx + bw / 2, by + 112, "system boundary", 11, "middle", "400", GREY))
    for i, t in enumerate(["Ballot recording & tally", "Voting-session control", "Audit log"]):
        s.append(txt(bx + bw / 2, by + 168 + i * 30, "\u00b7  " + t, 12.5, "middle", "400", "#3c5a80"))

    # actors: association lines leave at arm height
    for (ax, atop, label) in [(170, 195, "Voter"), (170, 420, "Presiding Officer")]:
        s.append(actor(ax, atop, label))
        y = atop + 31
        s.append(line([(ax + 42, y), (bx, y)], LIGHT, 1.6))
    for (ax, atop, label) in [(1330, 195, "Election Administrator"), (1330, 420, "Auditor")]:
        s.append(actor(ax, atop, label))
        y = atop + 31
        s.append(line([(bx + bw, y), (ax - 42, y)], LIGHT, 1.6))

    # external systems beneath the boundary
    for x, name, desc in [(560, "OTP delivery service", "sends the one-time password"),
                          (940, "Identity registry", "read-only voter-ID lookup")]:
        yy = 640
        s.append(box(x, yy, 300, 96, fill="#ffffff", stroke=GREY, sw=1.6, rx=8, dash="7,4"))
        s.append(txt(x + 150, yy + 32, name, 12.5, "middle", "650", "#44506a"))
        s.append(txt(x + 150, yy + 54, "\u00abexternal system\u00bb", 10, "middle", "400", GREY,
                     'font-style="italic"'))
        s.append(txt(x + 150, yy + 76, desc, 10.5, "middle", "400", GREY))
        s.append(line([(x + 58, by + bh), (x + 58, yy)], LIGHT, 1.6, "6,4", "arw"))
        s.append(txt(x + 70, by + bh + 26, "interface", 10, "start", "400", GREY,
                     'font-style="italic"'))

    s.append(txt(W / 2, H - 30,
                 "The two external systems are outside the boundary: the election system calls them "
                 "but does not own them, so their interfaces are constraints on the design.",
                 11, "middle", "400", GREY, 'font-style="italic"'))
    return doc(W, H, "".join(s), "Figure 1 — Context model")


# ================================================================ FIG 2 use case
def fig2():
    W, H = 1620, 1000
    s = []
    bl, bt, br, bb = 260, 120, 1350, 890
    s.append(box(bl, bt, br - bl, bb - bt, fill="#f7f9fc", stroke=NAVY, sw=2, rx=12))
    s.append(txt(bl + 18, bt + 28, "ELECTION MANAGEMENT AND VOTING SYSTEM", 12.5, "start", "700", NAVY))
    s.append(txt(bl + 18, bt + 46, "system boundary", 10, "start", "400", "#7c8aa2"))

    BW, BH = 330, 44
    colA, colB = 400, 930
    rows = [320, 406, 492, 578, 664]

    def cy(r):
        return r + BH / 2

    hub_x, hub_y = colA, 180
    hub_cy = hub_y + BH / 2

    A = {"UC5": (colA, rows[0], "UC5  Cast vote"),
         "UC6": (colA, rows[1], "UC6  Check vote receipt"),
         "UC8": (colA, rows[2], "UC8  Mark voter as voted"),
         "UC3": (colA, rows[3], "UC3  Verify eligibility"),
         "UC4": (colA, rows[4], "UC4  View ballot")}
    B = {"UC1": (colB, rows[0], "UC1  Register voter"),
         "UC7": (colB, rows[1], "UC7  Manage voting session"),
         "UC9": (colB, rows[2], "UC9  View results"),
         "UC10": (colB, rows[3], "UC10  View audit log")}

    # include arrows: UC5 -> hub is a straight vertical
    s.append(line([(colA + BW / 2, A["UC5"][1]), (colA + BW / 2, hub_y + BH)],
                  GOLD, 1.6, "6,4", "arwg"))
    for i, k in enumerate(["UC6", "UC8", "UC3", "UC4"]):
        x, y, _ = A[k]
        gx = colA - 32 - i * 24
        s.append(line([(x, cy(y)), (gx, cy(y)), (gx, hub_cy), (hub_x, hub_cy)],
                      GOLD, 1.5, "6,4", "arwg"))
    for i, k in enumerate(["UC3", "UC4"]):
        x, y, _ = A[k]
        rx = colA + BW + 18 + i * 20
        s.append(line([(x + BW, cy(A["UC5"][1])), (rx, cy(A["UC5"][1])),
                       (rx, cy(y)), (x + BW, cy(y))], GOLD, 1.5, "6,4", "arwg"))
    for i, k in enumerate(["UC1", "UC7", "UC9", "UC10"]):
        x, y, _ = B[k]
        gx = colB - 38 - i * 24
        s.append(line([(x, cy(y)), (gx, cy(y)), (gx, hub_cy), (hub_x + BW, hub_cy)],
                      GOLD, 1.5, "6,4", "arwg"))

    s.append(uc(hub_x, hub_y, BW, BH, "UC2  Authenticate (password + OTP)", 12))
    for k in A:
        x, y, lab = A[k]
        s.append(uc(x, y, BW, BH, lab, 12))
    for k in B:
        x, y, lab = B[k]
        s.append(uc(x, y, BW, BH, lab, 12))

    def bus_left(ax, ay, targets, tx=228):
        ys = [cy(A[t][1]) if t in A else cy(B[t][1]) for t in targets]
        span = ys + [ay]
        out = [line([(ax + 42, ay), (tx, ay)], LIGHT, 1.5)]
        out.append(line([(tx, min(span)), (tx, max(span))], LIGHT, 1.5))
        for yy in ys:
            out.append(line([(tx, yy), (colA, yy)], LIGHT, 1.5))
        return "".join(out)

    def bus_right(ax, ay, targets, tx):
        ys = [cy(A[t][1]) if t in A else cy(B[t][1]) for t in targets]
        span = ys + [ay]
        out = [line([(ax - 42, ay), (tx, ay)], LIGHT, 1.5)]
        out.append(line([(tx, min(span)), (tx, max(span))], LIGHT, 1.5))
        for yy in ys:
            out.append(line([(colB + BW, yy), (tx, yy)], LIGHT, 1.5))
        return "".join(out)

    s.append(actor(130, 300, "Voter"))
    s.append(bus_left(130, 360, ["UC5", "UC6"]))
    s.append(actor(130, 620, "Presiding Officer"))
    s.append(bus_left(130, 680, ["UC8"]))

    s.append(actor(1450, 300, "Election Administrator"))
    s.append(bus_right(1450, 360, ["UC1", "UC7", "UC9"], 1382))
    s.append(actor(1450, 700, "Auditor"))
    s.append(bus_right(1450, 760, ["UC9", "UC10"], 1428))

    s.append(box(bl + 20, bb - 76, 330, 54, fill="#fbfcfe", stroke="#dbe3ee", sw=1, rx=6))
    s.append(line([(bl + 36, bb - 49), (bl + 80, bb - 49)], GOLD, 1.5, "6,4", "arwg"))
    s.append(txt(bl + 92, bb - 44, "\u00abinclude\u00bb  always performed", 11, "start", "400", "#5b6b85"))
    return doc(W, H, "".join(s), "Figure 2 \u2014 Use case diagram")


# ================================================================ sequence helper
def seq_diagram(W, H, parts, msgs, frags, title, footer=None, band=None):
    """parts: [(label, x)]  msgs: [(kind, from_i, to_i, label)]  frags: [(top, bot, guard)]"""
    s = []
    top = 96
    n = len(parts)

    # participant boxes
    head = []
    for label, x in parts:
        head.append((x, label))

    # lifelines
    for label, x in parts:
        s.append(f'<line x1="{x}" y1="{top + 46}" x2="{x}" y2="{H - 70}" stroke="{LIGHT}" '
                 f'stroke-width="1.2" stroke-dasharray="5,5"/>')
        w = 190
        s.append(box(x - w / 2, top, w, 46, fill="#eef3f9", stroke=BLUE, sw=1.6, rx=6))
        s.append(txt(x, top + 28, label, 11.5, "middle", "650", NAVY))

    # fragment
    for (ftop, fbot, guard) in frags:
        fx = min(x for _, x in parts) - 80
        fw = max(x for _, x in parts) - min(x for _, x in parts) + 160
        s.append(box(fx, ftop, fw, fbot - ftop, fill="none", stroke=BLUE, sw=1.3))
        s.append(box(fx, ftop, 46, 22, fill="#eef3f9", stroke=BLUE, sw=1.3))
        s.append(txt(fx + 23, ftop + 16, "alt", 11, "middle", "700", NAVY))
        s.append(txt(fx + 56, ftop + 16, guard, 10.5, "start", "400", "#33415c"))

    act = {}
    y = top + 74
    xs = [x for _, x in parts]

    for m in msgs:
        kind = m[0]
        if kind == "note":
            _, text = m
            s.append(txt(min(xs) - 70, y + 4, text, 10.5, "start", "400", "#5b6b85",
                        'font-style="italic"'))
            y += 26
            continue
        if kind == "gap":
            y += m[1]
            continue
        if kind == "band":
            _, label = m
            fx = min(xs) - 80
            fw = max(xs) - min(xs) + 160
            s.append(box(fx, y - 14, fw, 30, fill=BAND, stroke=BLUE, sw=1.2))
            s.append(txt(fx + fw / 2, y + 6, label, 10.5, "middle", "700", NAVY))
            y += 40
            continue

        _, fi, ti, label, *rest = m
        ret = rest[0] if rest else False
        x1, x2 = xs[fi], xs[ti]
        col = BLUE if not ret else LIGHT
        dash = "6,4" if ret else ""
        mk = "arwo" if not ret else "arw"
        s.append(line([(x1, y), (x2, y)], col, 1.6, dash, mk))
        s.append(txt(220, y - 6, label, 10.5, "end", "400", INK))
        ay = f"a{fi}"
        act.setdefault((fi, ti), None)
        y += 30

    return doc(W, H, "".join(s), title)


# ================================================================ sequence renderer
def render_sequence(W, H, title, parts, script, footer=None):
    """parts: [(label, x)]   script: list of directives, executed in order.

    Directives:
      ("m",  fi, ti, label, ret?)      message between lifeline indices
      ("band", label)                  full-width divider band
      ("region", "begin"|"end", label) critical-region box
      ("alt", "begin"|"end", guard)    alt fragment
      ("guard", label, colour)         a guard row inside the current fragment
      ("space", px)                    vertical gap
    """
    s = []
    top = 100
    xs = [x for _, x in parts]
    left, right = min(xs) - 150, max(xs) + 150

    for label, x in parts:
        s.append(f'<line x1="{x}" y1="{top + 48}" x2="{x}" y2="{H - 60}" stroke="{LIGHT}" '
                 f'stroke-width="1.2" stroke-dasharray="5,5"/>')
        s.append(box(x - 150, top, 300, 48, fill="#eef3f9", stroke=BLUE, sw=1.6, rx=6))
        s.append(txt(x, top + 30, label, 11.5, "middle", "650", NAVY))

    y = top + 78
    open_region = None
    open_frag = None

    def arrow(yy, fi, ti, label, ret=False):
        x1, x2 = xs[fi], xs[ti]
        if fi == ti:
            # self-message: a small rectangular loop to the right of the lifeline
            s.append(line([(x1, yy - 10), (x1 + 74, yy - 10), (x1 + 74, yy + 10),
                           (x1 + 6, yy + 10)], BLUE, 1.6, "", "arwo"))
            s.append(txt(x1 + 88, yy + 4, label, 10.5, "start", "400", INK))
            return yy + 22
        s.append(line([(x1, yy), (x2, yy)], LIGHT if ret else BLUE, 1.6,
                      "6,4" if ret else "", "arw" if ret else "arwo"))
        mid = (x1 + x2) / 2
        tw = len(label) * 5.5
        cx = max(left + 12 + tw / 2, min(mid, W - 20 - tw / 2))
        s.append(txt(cx, yy - 7, label, 10.5, "middle", "400", INK))
        return yy

    for d in script:
        kind = d[0]
        if kind == "m":
            _, fi, ti, label = d[:4]
            ret = d[4] if len(d) > 4 else False
            y = arrow(y, fi, ti, label, ret) + 31
        elif kind == "space":
            y += d[1]
        elif kind == "band":
            s.append(box(left, y - 14, right - left, 32, fill=BAND, stroke=BLUE, sw=1.2))
            s.append(txt((left + right) / 2, y + 8, d[1], 10.8, "middle", "700", NAVY))
            y += 46
        elif kind == "region":
            _, mode, label = d[:3]
            if mode == "begin":
                open_region = (y - 16, label)
                y += 30
            else:
                ry, lab = open_region
                s.append(box(left + 6, ry, right - left - 12, y - ry, fill="none",
                             stroke=GOLD, sw=1.6))
                s.append(box(left + 6, ry, 300, 24, fill="#fff3cd", stroke=GOLD, sw=1.2))
                s.append(txt(left + 18, ry + 17, lab, 10.8, "start", "700", "#7a5a00"))
                y += 26
        elif kind == "alt":
            _, mode, guard = d[:3]
            if mode == "begin":
                open_frag = (y - 14, guard)
                y += 28
            else:
                fy, g = open_frag
                s.append(box(left + 6, fy, right - left - 12, y - fy, fill="none",
                             stroke=BLUE, sw=1.3))
                s.append(box(left + 6, fy, 46, 24, fill="#eef3f9", stroke=BLUE, sw=1.3))
                s.append(txt(left + 29, fy + 17, "alt", 11, "middle", "700", NAVY))
                s.append(txt(left + 60, fy + 17, g, 10.5, "start", "400", "#33415c"))
                y += 22
        elif kind == "guard":
            _, label, colour = d[:3]
            s.append(txt(left + 60, y - 4, label, 10.5, "start", "600", colour))
            y += 4

    if footer:
        s.append(txt(left + 10, H - 26, footer, 10.5, "start", "400", GREY,
                     'font-style="italic"'))
    return doc(W, H, "".join(s), title)


# ================================================================ FIG 3 cast vote
def fig3():
    W, H = 1720, 1650
    parts = [("Vue client (browser)", 270), ("API route (Express)", 640),
             ("Voting service", 1010), ("Database (SQLite)", 1380)]
    script = [
        ("m", 0, 1, "1. POST /auth/login { voterId, password }"),
        ("m", 1, 2, "2. authenticate(voterId, password)"),
        ("m", 2, 3, "3. SELECT user, failed_attempts, locked"),
        ("m", 3, 2, "4. user row", True),
        ("m", 2, 3, "5. INSERT otp_challenge (code, expires)"),
        ("m", 2, 1, "6. challengeId", True),
        ("m", 1, 0, "7. challengeId  (OTP delivered out of band)", True),
        ("m", 0, 1, "8. POST /auth/verify { challengeId, code }"),
        ("m", 1, 2, "9. verifyOtp()"),
        ("m", 2, 3, "10. SELECT challenge, check expiry + consumed"),
        ("m", 2, 3, "11. mark consumed, INSERT session"),
        ("m", 2, 1, "12. token (32 random bytes)", True),
        ("m", 1, 0, "13. 200 { token, role, name }", True),
        ("band", "\u00abinclude\u00bb  UC2 Authenticate \u2014 completed, session token issued"),
        ("m", 0, 1, "14. GET /elections  (Bearer token)"),
        ("m", 1, 2, "15. requireAuth \u2192 user, requireRole"),
        ("m", 2, 3, "16. SELECT elections WHERE status = open"),
        ("m", 3, 2, "17. rows", True),
        ("m", 2, 1, "18. elections", True),
        ("m", 1, 0, "19. election list", True),
        ("m", 0, 1, "20. GET /elections/:id/ballot"),
        ("m", 1, 2, "21. UC3 + UC4: check eligibility, list candidates"),
        ("m", 2, 3, "22. SELECT candidates"),
        ("m", 3, 2, "23. rows", True),
        ("m", 2, 1, "24. ballot", True),
        ("m", 1, 0, "25. ballot", True),
        ("m", 0, 1, "26. POST /vote { electionId, candidateId }"),
        ("region", "begin", "critical \u00b7 one transaction \u00b7 BEGIN IMMEDIATE"),
        ("m", 2, 3, "27. re-check status = open  AND  has_voted = 0"),
        ("m", 3, 2, "28. status, flag", True),
        ("m", 2, 2, "29. encrypt(choice) \u2014 AES-256-GCM in the service layer"),
        ("m", 2, 3, "30. INSERT ballot (ciphertext, iv, tag, voter_hash)"),
        ("m", 2, 3, "31. UPDATE users SET has_voted = 1"),
        ("m", 2, 3, "32. INSERT audit_log ('vote accepted')"),
        ("m", 2, 3, "33. COMMIT"),
        ("region", "end", ""),
        ("space", 10),
        ("alt", "begin", "[committed]"),
        ("m", 2, 1, "34. receiptCode", True),
        ("m", 1, 0, "35. 200 { receiptCode }", True),
        ("guard", "[rolled back \u2014 closed / already voted / not eligible]", RED),
        ("m", 2, 1, "36. reason code", True),
        ("m", 1, 0, "37. 409 { reason }", True),
        ("alt", "end", ""),
    ]
    return render_sequence(
        W, H, "Figure 3 \u2014 Sequence diagram: cast vote (UC5)", parts, script,
        "Steps 27\u201333 happen as a unit. There is no observable state in which a ballot row exists "
        "without has_voted being set \u2014 which is what makes D2 hold under concurrency.")


# ================================================================ FIG 4 authenticate
def fig4():
    W, H = 1680, 1240
    parts = [("Vue client (browser)", 250), ("API route (Express)", 620),
             ("Auth service", 990), ("Database (SQLite)", 1360)]
    script = [
        ("m", 0, 1, "1. POST /auth/login { voterId, password }"),
        ("m", 1, 2, "2. authenticate(voterId, password)"),
        ("m", 2, 3, "3. SELECT user, failed_attempts, locked"),
        ("m", 3, 2, "4. user row", True),
        ("m", 2, 2, "5. scrypt verify \u2014 constant time"),
        ("m", 2, 3, "6. INSERT otp_challenge (code, expires_at)"),
        ("m", 2, 1, "7. challengeId", True),
        ("m", 1, 0, "8. challengeId  (OTP delivered out of band)", True),
        ("space", 6),
        ("m", 0, 1, "9. POST /auth/verify { challengeId, code }"),
        ("m", 1, 2, "10. verifyOtp()"),
        ("m", 2, 3, "11. SELECT challenge, check expiry + consumed"),
        ("alt", "begin", "[code matches, not expired, not consumed]"),
        ("m", 2, 3, "12. mark consumed, INSERT session"),
        ("m", 2, 1, "13. token (32 random bytes)", True),
        ("m", 1, 0, "14. 200 { token, role, name }", True),
        ("guard", "[wrong code / expired / already consumed]", RED),
        ("m", 2, 3, "15. UPDATE failed_attempts +1  (lock at 5)"),
        ("m", 2, 1, "16. reason", True),
        ("m", 1, 0, "17. 401 { reason }", True),
        ("alt", "end", ""),
    ]
    return render_sequence(
        W, H, "Figure 4 \u2014 Sequence diagram: authenticate (UC2)", parts, script,
        "The client never receives the expected OTP \u2014 only a challengeId to submit against \u2014 so a "
        "compromised browser learns nothing reusable. The session token is opaque and stored server-side.")


# ================================================================ FIG 5 class
def fig5():
    W, H = 1560, 1000
    s = []

    def cls(x, y, w, name, attrs, ops):
        lh = 17
        h = 26 + len(attrs) * lh + (len(ops) * lh + 12 if ops else 0) + 8
        out = [box(x, y, w, h, rx=4)]
        out.append(f'<line x1="{x}" y1="{y + 26}" x2="{x + w}" y2="{y + 26}" '
                   f'stroke="{BLUE}" stroke-width="1.4"/>')
        if ops:
            sy = y + 22 + len(attrs) * lh + 8
            out.append(f'<line x1="{x}" y1="{sy}" x2="{x + w}" y2="{sy}" '
                       f'stroke="{BLUE}" stroke-width="1"/>')
        out.append(txt(x + w / 2, y + 18, name, 12.5, "middle", "700", NAVY))
        yy = y + 44
        for a in attrs:
            out.append(txt(x + 12, yy, a, 10.5, "start", "400", INK))
            yy += lh
        if ops:
            yy += 8
            for o in ops:
                out.append(txt(x + 12, yy, o, 10.5, "start", "400", "#2c4a6e"))
                yy += lh
        return "".join(out), h

    u, hu = cls(60, 120, 300, "User",
                ["- id: int", "- voterId: string", "- name: string", "- passwordHash: string",
                 "- role: enum", "- failedAttempts: int"],
                ["+ isLocked(): bool"])
    e, he = cls(430, 120, 300, "Election",
                ["- id: int", "- title: string", "- status: enum", "- createdAt: date"],
                ["+ isOpen(): bool"])
    c, hc = cls(800, 120, 300, "Candidate",
                ["- id: int", "- electionId: int", "- name: string", "- party: string"], [])
    vr, hvr = cls(60, 420, 310, "VoterRoll",
                  ["- electionId: int", "- userId: int", "- hasVoted: bool", "- votedAt: date"], [])
    b, hb = cls(430, 400, 340, "Ballot",
                ["- id: int", "- electionId: int", "- voterHash: string", "- payload: blob",
                 "- iv: string", "- authTag: string", "- receiptCode: string", "- createdAt: date"],
                ["+ decrypt(): choice"])
    se, hs = cls(1130, 400, 300, "Session",
                 ["- token: string", "- userId: int", "- expiresAt: date"], [])
    a, ha = cls(60, 690, 340, "AuditEntry",
                ["- id: int", "- actor: string", "- action: string", "- detail: string",
                 "- createdAt: date"], [])

    for blk in (u, e, c, vr, b, se, a):
        s.append(blk)

    # Election 1 --- * Candidate
    s.append(line([(730, 170), (800, 170)], LIGHT, 1.6))
    s.append(txt(738, 162, "1", 10, "start", "600", GREY))
    s.append(txt(790, 162, "*", 10, "end", "600", GREY))

    # User 1 --- * VoterRoll  (the flag that enforces D1, per election)
    s.append(line([(210, 120 + hu), (210, 420)], LIGHT, 1.6))
    s.append(txt(220, 130 + hu, "1", 10, "start", "600", GREY))
    s.append(txt(220, 412, "*", 10, "start", "600", GREY))

    # Election 1 --- * Ballot  (straight down, both are in the same column)
    s.append(line([(600, 120 + he), (600, 400)], LIGHT, 1.6))
    s.append(txt(610, 130 + he, "1", 10, "start", "600", GREY))
    s.append(txt(610, 392, "*", 10, "start", "600", GREY))

    # Election 1 --- * VoterRoll  (out of the left edge, down, into the right edge)
    s.append(line([(430, 175), (400, 175), (400, 465), (370, 465)], LIGHT, 1.6))
    s.append(txt(438, 167, "1", 10, "start", "600", GREY))
    s.append(txt(364, 457, "*", 10, "end", "600", GREY))

    # User 1 --- * Session (around the left edge and along the bottom)
    s.append(line([(60, 215), (30, 215), (30, 940), (1280, 940), (1280, 400 + hs)], LIGHT, 1.6))
    s.append(txt(40, 207, "1", 10, "start", "600", GREY))
    s.append(txt(1270, 505, "*", 10, "end", "600", GREY))

    # notes
    s.append(note(810, 700, 360, 120,
                  ["Deliberately no association", "between User and Ballot.",
                   "",
                   "Ballot.voterHash =",
                   "HMAC(voterId, electionId, key)",
                   "— enough to detect a duplicate,", "not enough to identify the voter."]))
    s.append(note(810, 420, 300, 120,
                  ["VoterRoll, not User.hasVoted.",
                   "D1 says “once per election”, so",
                   "the flag must be keyed by",
                   "election: a single column on",
                   "User would be wrong as soon as",
                   "a second election exists."]))

    s.append(txt(W / 2, H - 30, "Every box is a table in the SQLite schema; the three notes "
                                "record decisions the diagram would otherwise leave ambiguous.",
                 11, "middle", "400", GREY, 'font-style="italic"'))
    return doc(W, H, "".join(s), "Figure 5 — Class diagram (persistent entities)")


# ================================================================ FIG 6 state
def fig6():
    W, H = 1600, 760
    s = []
    s.append(txt(60, 60, "Election lifecycle", 13, "start", "700", NAVY))
    s.append(txt(880, 60, "Ballot lifecycle", 13, "start", "700", NAVY))

    def st(x, y, w, label, fill="#eef3f9"):
        return box(x, y, w, 48, fill=fill, stroke=BLUE, sw=1.7, rx=10) + \
               txt(x + w / 2, y + 30, label, 12, "middle", "650", NAVY)

    # --- election machine
    s.append(f'<circle cx="{70}" cy="{150}" r="9" fill="{NAVY}"/>')
    s.append(line([(79, 150), (150, 150)], LIGHT, 1.6, "", "arw"))
    s.append(st(150, 126, 150, "Draft"))
    s.append(line([(300, 150), (400, 150)], LIGHT, 1.6, "", "arw"))
    s.append(txt(350, 140, "open()", 10.5, "middle", "400", "#33415c"))
    s.append(st(400, 126, 150, "Open", "#e7f3e9"))
    s.append(line([(550, 150), (650, 150)], LIGHT, 1.6, "", "arw"))
    s.append(txt(600, 140, "close()", 10.5, "middle", "400", "#33415c"))
    s.append(st(650, 126, 150, "Closed"))
    s.append(line([(800, 150), (900, 150)], LIGHT, 1.6, "", "arw"))
    s.append(txt(850, 140, "publish()", 10.5, "middle", "400", "#33415c"))
    s.append(st(900, 126, 170, "Published", "#f2f2f2"))
    s.append(f'<circle cx="{1110}" cy="{150}" r="10" fill="none" stroke="{NAVY}" stroke-width="1.8"/>')
    s.append(f'<circle cx="{1110}" cy="{150}" r="5" fill="{NAVY}"/>')
    s.append(line([(1070, 150), (1100, 150)], LIGHT, 1.6, "", "arw"))

    s.append(note(150, 230, 520, 90,
                  ["Open → Closed is the only route to a publishable state.",
                   "No transition leaves Closed, so a published count cannot",
                   "silently become an editable one (D4).",
                   "Guard on both close() and publish(): caller role = administrator."]))

    # --- ballot machine
    bx = 880
    s.append(f'<circle cx="{bx - 40}" cy="{420}" r="9" fill="{NAVY}"/>')
    s.append(line([(bx - 31, 420), (bx, 420)], LIGHT, 1.6, "", "arw"))
    s.append(st(bx, 396, 170, "Unsubmitted"))
    s.append(line([(bx + 170, 420), (bx + 250, 420)], LIGHT, 1.6, "", "arw"))
    s.append(txt(bx + 210, 410, "cast()", 10.5, "middle", "400", "#33415c"))
    s.append(st(bx + 250, 396, 170, "Encrypting", "#fff8e6"))
    s.append(line([(bx + 420, 420), (bx + 500, 380)], LIGHT, 1.6, "", "arw"))
    s.append(txt(bx + 470, 372, "commit", 10.5, "middle", "400", GREEN))
    s.append(st(bx + 500, 356, 170, "Committed", "#e7f3e9"))
    s.append(line([(bx + 420, 420), (bx + 500, 480)], LIGHT, 1.6, "", "arw"))
    s.append(txt(bx + 470, 512, "rollback", 10.5, "middle", "400", RED))
    s.append(st(bx + 500, 456, 170, "Rejected", "#fdecea"))

    s.append(note(880, 560, 620, 76,
                  ["Committed has no outgoing transition. D3 says an accepted vote cannot be",
                   "amended or deleted, so the model provides no edge for it — a stronger",
                   "guarantee than a permission check in a service method."]))
    return doc(W, H, "".join(s), "Figure 6 — State machine models")


# ================================================================ FIG 7 activity
def fig7():
    W, H = 1340, 1240
    s = []
    cx = 560
    LW, RW = 200, 940          # x centres of the two failure columns

    def act(y, label, w=360, fill="#eef3f9", center=cx):
        return box(center - w / 2, y, w, 46, fill=fill, stroke=BLUE, sw=1.6, rx=23) + \
               txt(center, y + 29, label, 11.5, "middle", "600", NAVY)

    def dia(y, label, w=300, half=34):
        return (f'<polygon points="{cx - w/2},{y} {cx},{y - half} {cx + w/2},{y} '
                f'{cx},{y + half}" fill="#fff8e6" stroke="{GOLD}" stroke-width="1.6"/>' +
                txt(cx, y + 5, label, 11, "middle", "600", "#5a4a1a"))

    def down(x1, y1, y2, colour=LIGHT):
        s.append(line([(x1, y1), (x1, y2)], colour, 1.6, "", "arw"))

    # start
    s.append(f'<circle cx="{cx}" cy="60" r="13" fill="{NAVY}"/>')
    down(cx, 73, 106)
    s.append(act(106, "Voter submits voter ID + password"))
    down(cx, 152, 184)
    s.append(act(184, "System verifies credential, issues OTP"))
    down(cx, 230, 262)
    s.append(act(262, "Voter enters one-time password"))
    down(cx, 308, 336)
    s.append(dia(370, "OTP valid?"))

    # [no] branch -> left column
    s.append(line([(cx - 150, 370), (LW, 370), (LW, 460)], LIGHT, 1.6, "", "arw"))
    s.append(txt(cx - 142, 362, "[no]", 10.5, "start", "600", RED))
    s.append(act(460, "Reject, count failed attempt", 300, "#fdecea", center=LW))

    # [yes] continues
    down(cx, 404, 434)
    s.append(txt(cx + 10, 426, "[yes]", 10.5, "start", "600", GREEN))
    s.append(act(434, "Issue session token"))
    down(cx, 480, 508)
    s.append(dia(542, "Eligible &amp; not voted?"))

    # [no] branch -> right column
    s.append(line([(cx + 150, 542), (RW, 542), (RW, 620)], LIGHT, 1.6, "", "arw"))
    s.append(txt(cx + 158, 534, "[no]", 10.5, "start", "600", RED))
    s.append(act(620, "Reject, write audit entry", 300, "#fdecea", center=RW))

    # [yes] continues
    down(cx, 576, 606)
    s.append(txt(cx + 10, 598, "[yes]", 10.5, "start", "600", GREEN))
    s.append(act(606, "Show candidate list"))
    down(cx, 652, 680)
    s.append(act(680, "Voter confirms one candidate", 360, "#fff8e6"))
    down(cx, 726, 754)
    s.append(act(754, "BEGIN IMMEDIATE \u00b7 re-check \u00b7 encrypt", 400, "#fff8e6"))
    down(cx, 800, 828)
    s.append(act(828, "INSERT ballot + SET has_voted", 400, "#fff8e6"))
    down(cx, 874, 902)
    s.append(act(902, "COMMIT \u00b7 write audit \u00b7 return receipt", 400, "#e7f3e9"))

    # all three paths merge, then reach the final node
    merge_y = 1030
    down(cx, 948, merge_y, LIGHT)
    s.append(line([(LW, 506), (LW, merge_y), (cx, merge_y)], LIGHT, 1.6))
    s.append(line([(RW, 666), (RW, merge_y), (cx, merge_y)], LIGHT, 1.6))
    s.append(f'<polygon points="{cx-16},{merge_y} {cx},{merge_y-15} {cx+16},{merge_y} '
             f'{cx},{merge_y+15}" fill="#ffffff" stroke="{LIGHT}" stroke-width="1.5"/>')
    down(cx, merge_y + 15, 1092)
    s.append(f'<circle cx="{cx}" cy="1110" r="16" fill="none" stroke="{NAVY}" stroke-width="2"/>')
    s.append(f'<circle cx="{cx}" cy="1110" r="9" fill="{NAVY}"/>')

    s.append(note(980, 130, 320, 130,
                  ["The three shaded activities",
                   "are one unit of work.",
                   "",
                   "They are drawn separately",
                   "only to show the order inside",
                   "the transaction; there is no",
                   "pause between them that",
                   "another request can observe."]))
    s.append(txt(W / 2, H - 26,
                 "Every path ends at the same final node. The paper path (UC8) also converges on "
                 "'mark voter as voted', which is what keeps D1 true.",
                 11, "middle", "400", GREY, 'font-style="italic"'))
    return doc(W, H, "".join(s), "Figure 7 — Activity model: voting process")


# ================================================================ FIG 8 architecture
def fig8():
    W, H = 1500, 940
    s = []
    layers = [
        ("Presentation layer", "Vue 3 single-page client — Login / Ballot / Receipt / Results / Audit",
         "#e8eef7", 90),
        ("Route / API layer", "Express routers · request validation · requireAuth · requireRole",
         "#dfe8f5", 240),
        ("Service layer", "authService · votingService · resultService · auditService  —  ALL business rules, "
         "transactions, crypto", "#ffeeba" if False else "#fff3cd", 390),
        ("Data layer", "node:sqlite repositories · schema · seed  —  parameterised queries only",
         "#e7f3e9", 540),
    ]
    for name, desc, fill, y in layers:
        s.append(box(120, y, 1000, 116, fill=fill, stroke=NAVY, sw=1.8, rx=10))
        s.append(txt(146, y + 40, name, 15, "start", "700", NAVY))
        s.append(txt(146, y + 72, desc, 11.5, "start", "400", "#33415c"))

    # arrows between layers
    for y in (206, 356, 506):
        s.append(line([(620, y), (620, y + 34)], LIGHT, 1.8, "", "arw"))
        s.append(line([(700, y + 34), (700, y)], LIGHT, 1.8, "", "arw"))

    # side annotations of where the critical assets live
    s.append(note(1160, 380, 300, 150,
                  ["Security-critical assets",
                   "live in the service layer:",
                   "",
                   "· AES key (config, never sent",
                   "  to the client)",
                   "· plaintext ballot choice",
                   "· the transaction boundary"]))
    s.append(note(1160, 130, 300, 96,
                  ["The API layer holds no",
                   "business rule. A bug here",
                   "can mis-route a request but",
                   "cannot invent a second",
                   "ballot."], 10.5))

    # external systems
    s.append(box(120, 700, 300, 74, fill="#fff", stroke=GREY, sw=1.5, rx=8, dash="7,4"))
    s.append(txt(270, 731, "OTP delivery service", 12, "middle", "650", "#44506a"))
    s.append(txt(270, 753, "external, outbound only", 10, "middle", "400", GREY))

    s.append(box(470, 700, 300, 74, fill="#fff", stroke=GREY, sw=1.5, rx=8, dash="7,4"))
    s.append(txt(620, 731, "Identity registry", 12, "middle", "650", "#44506a"))
    s.append(txt(620, 753, "external, read-only", 10, "middle", "400", GREY))

    s.append(line([(300, 656), (300, 700)], LIGHT, 1.6, "6,4", "arw"))
    s.append(line([(620, 656), (620, 700)], LIGHT, 1.6, "6,4", "arw"))

    s.append(txt(720, 830, "Layered architecture — dependencies point downward only; "
                           "no layer calls upward.", 11.5, "start", "400", GREY, 'font-style="italic"'))
    return doc(W, H, "".join(s), "Figure 8 — Layered architecture")


# ================================================================ FIG 4 auth sequence
def fig4():
    W, H = 1600, 900
    parts = [("Vue client", 260), ("API Gateway", 640),
             ("Auth Service", 1020), ("Database", 1340)]
    s = []
    top = 96
    xs = [x for _, x in parts]
    for label, x in parts:
        s.append(f'<line x1="{x}" y1="{top + 46}" x2="{x}" y2="{H - 90}" stroke="{LIGHT}" '
                 f'stroke-width="1.2" stroke-dasharray="5,5"/>')
        s.append(box(x - 150, top, 300, 46, fill="#eef3f9", stroke=BLUE, sw=1.6, rx=6))
        s.append(txt(x, top + 29, label, 11.5, "middle", "650", NAVY))

    def m(y, fi, ti, label, ret=False):
        s.append(line([(xs[fi], y), (xs[ti], y)], LIGHT if ret else BLUE, 1.6,
                      "6,4" if ret else "", "arw" if ret else "arwo"))
        s.append(txt(xs[0] - 50, y - 6, label, 10.8, "start", "400", INK))
        return y + 32

    y = top + 74
    y = m(y, 0, 1, "1. POST /auth/login { voterId, password }")
    y = m(y, 1, 2, "2. authenticate(voterId, password)")
    y = m(y, 2, 3, "3. SELECT user, failed_attempts, locked")
    y = m(y, 3, 2, "4. user row", True)
    y = m(y, 2, 3, "5. INSERT otp_challenge (code, expires)")
    y = m(y, 2, 1, "6. challengeId", True)
    y = m(y, 1, 0, "7. challengeId  (the OTP is delivered out of band)", True)

    s.append(box(160, y - 12, W - 320, 30, fill=BAND, stroke=BLUE, sw=1.2))
    s.append(txt(W / 2, y + 10, "step 8 — the voter reads the code from the delivery channel", 10.5, "middle", "600", NAVY))
    y += 46

    y = m(y, 0, 1, "8. POST /auth/verify { challengeId, code }")
    y = m(y, 1, 2, "9. verifyOtp()")
    y = m(y, 2, 3, "10. SELECT challenge, check expiry + consumed")

    ftop = y - 10
    s.append(box(150, ftop, W - 300, 150, fill="none", stroke=BLUE, sw=1.3))
    s.append(box(150, ftop, 46, 22, fill="#eef3f9", stroke=BLUE, sw=1.3))
    s.append(txt(173, ftop + 16, "alt", 11, "middle", "700", NAVY))
    s.append(txt(206, ftop + 16, "[code matches and not expired]", 10.5, "start", "400", GREEN))
    yy = ftop + 34
    yy = m(yy, 2, 3, "11. mark consumed · INSERT session")
    yy = m(yy, 2, 1, "12. token (32 random bytes)", True)
    yy = m(yy, 1, 0, "13. 200 { token, role, name }", True)
    s.append(txt(206, ftop + 132, "[wrong code / expired / consumed]", 10.5, "start", "400", RED))
    yy = ftop + 150
    yy = m(yy, 2, 3, "14. UPDATE failed_attempts (+1, lock at 5)")
    yy = m(yy, 2, 1, "15. reason", True)
    yy = m(yy, 1, 0, "16. 401 { reason }", True)

    s.append(note(150, H - 200, 640, 104,
                  ["The client never receives the expected OTP. It receives a challengeId and",
                   "submits a code against it, so a compromised browser learns nothing reusable.",
                   "",
                   "The token is opaque: a 32-byte random value stored server-side. It carries no",
                   "claims the client could edit, so verification is a lookup rather than a",
                   "signature check."]))
    return doc(W, H, "".join(s), "Figure 4 — Sequence diagram: authenticate (UC2)")


# ================================================================ driver
FIGS = [
    ("fig1_context", fig1, 1520, 900),
    ("fig2_usecase", fig2, 1620, 1000),
    ("fig3_seq_cast_vote", fig3, 1720, 1650),
    ("fig4_seq_authenticate", fig4, 1680, 1240),
    ("fig5_class", fig5, 1560, 1000),
    ("fig6_state", fig6, 1600, 760),
    ("fig7_activity", fig7, 1340, 1240),
    ("fig8_architecture", fig8, 1500, 940),
]

if __name__ == "__main__":
    os.makedirs(TMP, exist_ok=True)
    for name, fn, w, h in FIGS:
        html = fn()
        hp = os.path.join(TMP, name + ".html")
        with open(hp, "w", encoding="utf-8") as f:
            f.write(html)
        png = os.path.join(OUT, name + ".png")
        if os.path.exists(png):
            os.remove(png)
        subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--force-device-scale-factor=2",
                        f"--window-size={w},{h}", f"--screenshot={png}",
                        "file:///" + hp.replace("\\", "/")], capture_output=True, text=True)
        ok = os.path.exists(png)
        print(f"{'OK ' if ok else 'FAIL'} {name}.png  {w}x{h}")
        if not ok:
            sys.exit(1)
