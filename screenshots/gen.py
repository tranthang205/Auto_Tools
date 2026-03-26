from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1280, 800
OUT = os.path.dirname(os.path.abspath(__file__))

def get_font(size, bold=False):
    paths = [
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/SFNSText.ttf',
        '/System/Library/Fonts/SFNS.ttf',
        '/Library/Fonts/Arial.ttf',
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except:
            pass
    return ImageFont.load_default()

font_xl = get_font(64)
font_lg = get_font(36)
font_md = get_font(22)
font_sm = get_font(16)
font_xs = get_font(13)

DARK = '#1a1b2e'
ACCENT = '#6366f1'
GREEN = '#10b981'
WHITE = '#ffffff'
GRAY = '#9ca3af'
CARD = '#25262b'
BORDER = '#2c2d32'

def rounded_rect(draw, xy, fill, radius=12, outline=None):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline)

def slide1_hero():
    img = Image.new('RGB', (W, H), DARK)
    draw = ImageDraw.Draw(img)
    # Gradient-like effect with rectangles
    for i in range(20):
        c = 26 + i * 2
        draw.rectangle([0, i*40, W, (i+1)*40], fill=f'#{c:02x}{c-6:02x}{c+20:02x}')

    # Logo
    draw.text((W//2, 220), 'AutoFB', fill=WHITE, font=font_xl, anchor='mm')
    draw.text((W//2, 290), 'Smart Facebook Engagement Assistant', fill=GRAY, font=font_md, anchor='mm')

    # Feature boxes
    features = [
        ('Dashboard', '📊'), ('AI Comments', '🤖'), ('Scenarios', '⚡'), ('Privacy', '🔒')
    ]
    bw, bh = 200, 100
    total = len(features) * bw + (len(features)-1) * 24
    sx = (W - total) // 2
    for i, (label, icon) in enumerate(features):
        x = sx + i * (bw + 24)
        y = 380
        rounded_rect(draw, [x, y, x+bw, y+bh], fill='#252540', radius=14, outline='#3a3a5c')
        draw.text((x + bw//2, y + 38), icon, fill=WHITE, font=font_lg, anchor='mm')
        draw.text((x + bw//2, y + 75), label, fill=GRAY, font=font_sm, anchor='mm')

    # Footer
    draw.text((W//2, 560), 'trancongthang.vn', fill='#555570', font=font_sm, anchor='mm')

    img.save(os.path.join(OUT, 'screenshot-1-hero.png'))
    print('✓ screenshot-1-hero.png')

def slide2_popup():
    img = Image.new('RGB', (W, H), '#0f172a')
    draw = ImageDraw.Draw(img)

    # Popup mockup
    px, py = 180, 120
    pw, ph = 300, 520
    rounded_rect(draw, [px, py, px+pw, py+ph], fill='#1a1b1e', radius=12, outline=BORDER)

    # Header
    draw.rectangle([px, py, px+pw, py+48], fill=CARD)
    draw.text((px+14, py+24), 'AutoFB', fill=ACCENT, font=font_sm, anchor='lm')
    draw.ellipse([px+pw-70, py+18, px+pw-58, py+30], fill=GREEN)
    draw.text((px+pw-52, py+24), 'Running', fill=GREEN, font=font_xs, anchor='lm')

    # Card: scenario
    cy = py + 64
    rounded_rect(draw, [px+12, cy, px+pw-12, cy+160], fill=CARD, radius=8, outline=BORDER)
    draw.text((px+24, cy+18), 'Scenario', fill=GRAY, font=font_xs)
    draw.text((px+pw-24, cy+18), 'Seeding Pro', fill=WHITE, font=font_xs, anchor='ra')
    draw.text((px+24, cy+44), 'Auto-stop', fill=GRAY, font=font_xs)
    draw.text((px+pw-24, cy+44), '30 min', fill=WHITE, font=font_xs, anchor='ra')
    draw.text((px+24, cy+70), 'Elapsed', fill=GRAY, font=font_xs)
    draw.text((px+pw-24, cy+70), '12:45', fill=GREEN, font=font_sm, anchor='ra')
    # Stop button
    rounded_rect(draw, [px+24, cy+100, px+pw-24, cy+136], fill='#1a1b1e', radius=8, outline='#ef4444')
    draw.text((px+pw//2, cy+118), 'Stop', fill='#ef4444', font=font_sm, anchor='mm')

    # Card: stats
    cy2 = cy + 176
    rounded_rect(draw, [px+12, cy2, px+pw-12, cy2+130], fill=CARD, radius=8, outline=BORDER)
    draw.text((px+24, cy2+14), 'Current Session', fill=GRAY, font=font_xs)

    stats = [('24', 'Like'), ('8', 'Cmt'), ('3', 'Friends'), ('5', 'Story'), ('2', 'Groups')]
    sw = (pw - 40) // len(stats)
    for i, (num, lbl) in enumerate(stats):
        sx = px + 20 + i * sw
        rounded_rect(draw, [sx, cy2+36, sx+sw-4, cy2+110], fill='#1a1b1e', radius=6)
        draw.text((sx + sw//2 - 2, cy2+62), num, fill=ACCENT, font=font_md, anchor='mm')
        draw.text((sx + sw//2 - 2, cy2+90), lbl, fill='#555', font=font_xs, anchor='mm')

    # Dashboard button
    cy3 = cy2 + 146
    rounded_rect(draw, [px+12, cy3, px+pw-12, cy3+40], fill='#1a1b1e', radius=8, outline=BORDER)
    draw.text((px+pw//2, cy3+20), 'Open Dashboard', fill=ACCENT, font=font_sm, anchor='mm')

    # Right side text
    draw.text((600, 300), 'Quick Control', fill=WHITE, font=font_xl, anchor='lm')
    draw.text((600, 370), 'From Popup', fill=WHITE, font=font_xl, anchor='lm')
    draw.text((600, 440), 'Select a scenario, set a timer,', fill=GRAY, font=font_md, anchor='lm')
    draw.text((600, 475), 'and start with one click.', fill=GRAY, font=font_md, anchor='lm')
    draw.text((600, 530), 'Monitor real-time stats', fill=GRAY, font=font_md, anchor='lm')
    draw.text((600, 565), 'without leaving Facebook.', fill=GRAY, font=font_md, anchor='lm')

    img.save(os.path.join(OUT, 'screenshot-2-popup.png'))
    print('✓ screenshot-2-popup.png')

def slide3_dashboard():
    img = Image.new('RGB', (W, H), '#0f172a')
    draw = ImageDraw.Draw(img)

    draw.text((W//2, 50), 'Full Analytics Dashboard', fill=WHITE, font=font_lg, anchor='mm')

    # Dashboard frame
    dx, dy = 80, 90
    dw, dh = W-160, H-140
    rounded_rect(draw, [dx, dy, dx+dw, dy+dh], fill='#f5f5f7', radius=12)

    # Tabs
    tabs = ['Overview', 'Scenarios', 'AI Comment', 'Settings', 'Logs']
    draw.rectangle([dx, dy, dx+dw, dy+48], fill='#ffffff')
    for i, t in enumerate(tabs):
        tx = dx + 30 + i * 160
        color = ACCENT if i == 0 else '#6b7280'
        draw.text((tx, dy+24), t, fill=color, font=font_sm, anchor='lm')
        if i == 0:
            draw.rectangle([tx-4, dy+44, tx+80, dy+48], fill=ACCENT)

    # Cards
    cy = dy + 70
    # Card 1: Total
    rounded_rect(draw, [dx+20, cy, dx+340, cy+240], fill='#ffffff', radius=10)
    draw.text((dx+40, cy+20), 'TOTAL ENGAGEMENT', fill='#6b7280', font=font_xs)
    draw.text((dx+40, cy+60), '347', fill=ACCENT, font=font_xl)
    # Mini chart bars
    bars = [45, 60, 35, 80, 70, 55, 90]
    for i, h in enumerate(bars):
        bx = dx + 40 + i * 40
        by = cy + 210 - int(h * 1.2)
        rounded_rect(draw, [bx, by, bx+28, cy+210], fill=ACCENT, radius=4)
    draw.text((dx + 180, cy + 228), 'Last 7 sessions', fill='#6b7280', font=font_xs, anchor='mm')

    # Card 2: This session
    rounded_rect(draw, [dx+360, cy, dx+680, cy+240], fill='#ffffff', radius=10)
    draw.text((dx+380, cy+20), 'THIS SESSION', fill='#6b7280', font=font_xs)
    session_stats = [('42', 'Likes', ACCENT), ('15', 'Comments', GREEN), ('6', 'Friends', '#f59e0b')]
    for i, (n, l, c) in enumerate(session_stats):
        sx = dx + 400 + i * 90
        draw.text((sx, cy+70), n, fill=c, font=font_lg)
        draw.text((sx, cy+110), l, fill='#6b7280', font=font_xs)
    # Session rate
    draw.text((dx+380, cy+160), 'Engagement rate', fill='#6b7280', font=font_xs)
    draw.text((dx+380, cy+185), '+23% vs last session', fill=GREEN, font=font_sm)

    # Card 3: History
    rounded_rect(draw, [dx+700, cy, dx+dw-20, cy+240], fill='#ffffff', radius=10)
    draw.text((dx+720, cy+20), 'RECENT SESSIONS', fill='#6b7280', font=font_xs)
    sessions = [
        'Today 09:15 — 42 likes · 15 cmt',
        'Yesterday 14:30 — 38 likes · 12 cmt',
        'Mar 24 08:00 — 55 likes · 20 cmt',
        'Mar 23 10:15 — 30 likes · 8 cmt',
        'Mar 22 09:00 — 48 likes · 18 cmt',
    ]
    for i, s in enumerate(sessions):
        draw.text((dx+720, cy+55+i*30), s, fill='#37383d', font=font_xs)

    # Bottom: Line chart area
    cy2 = cy + 260
    rounded_rect(draw, [dx+20, cy2, dx+dw-20, cy2+270], fill='#ffffff', radius=10)
    draw.text((dx+40, cy2+20), 'ACTIVITY TREND', fill='#6b7280', font=font_xs)
    # Draw line chart
    points = [(0, 40), (1, 55), (2, 35), (3, 70), (4, 60), (5, 80), (6, 75), (7, 90), (8, 65), (9, 85)]
    for i in range(len(points)-1):
        x1 = dx + 60 + points[i][0] * 100
        y1 = cy2 + 240 - int(points[i][1] * 2)
        x2 = dx + 60 + points[i+1][0] * 100
        y2 = cy2 + 240 - int(points[i+1][1] * 2)
        draw.line([x1, y1, x2, y2], fill=ACCENT, width=3)
        draw.ellipse([x1-4, y1-4, x1+4, y1+4], fill=ACCENT)
    lp = points[-1]
    lx = dx + 60 + lp[0] * 100
    ly = cy2 + 240 - int(lp[1] * 2)
    draw.ellipse([lx-4, ly-4, lx+4, ly+4], fill=ACCENT)

    img.save(os.path.join(OUT, 'screenshot-3-dashboard.png'))
    print('✓ screenshot-3-dashboard.png')

def slide4_ai():
    img = Image.new('RGB', (W, H), '#1a1b2e')
    draw = ImageDraw.Draw(img)
    # Gradient-ish
    for i in range(H//2, H):
        r = int(15 + (i - H//2) * 0.06)
        g = int(27 + (i - H//2) * 0.12)
        b = int(26 + (i - H//2) * 0.04)
        draw.line([0, i, W, i], fill=f'#{r:02x}{g:02x}{b:02x}')

    draw.text((W//2, 80), 'AI-Powered Smart Comments', fill=WHITE, font=font_lg, anchor='mm')
    draw.text((W//2, 120), 'Reads post content → Generates relevant comment', fill=GRAY, font=font_md, anchor='mm')

    # Post card
    px, py = 100, 200
    rounded_rect(draw, [px, py, px+440, py+280], fill=CARD, radius=14, outline=BORDER)
    draw.ellipse([px+20, py+20, px+56, py+56], fill=ACCENT)
    draw.text((px+70, py+28), 'John Doe', fill=WHITE, font=font_sm)
    draw.text((px+70, py+48), '2 hours ago', fill='#555', font=font_xs)

    post_lines = [
        'Just finished my first marathon!',
        '42km in 4 hours. The training was',
        'brutal but crossing that finish line',
        'made it all worth it 🏃‍♂️',
    ]
    for i, line in enumerate(post_lines):
        draw.text((px+20, py+85+i*28), line, fill='#c9cdd3', font=font_sm)

    # Action bar
    draw.line([px+20, py+210, px+420, py+210], fill=BORDER)
    draw.text((px+80, py+238), 'Like', fill=GRAY, font=font_sm, anchor='mm')
    draw.text((px+220, py+238), 'Comment', fill=GRAY, font=font_sm, anchor='mm')
    draw.text((px+360, py+238), 'Share', fill=GRAY, font=font_sm, anchor='mm')

    # Arrow
    draw.text((610, 340), '→', fill=GREEN, font=font_xl, anchor='mm')

    # Result card
    rx, ry = 700, 240
    rounded_rect(draw, [rx, ry, rx+460, ry+200], fill='#0f2b1a', radius=14, outline=GREEN)
    draw.text((rx+20, ry+20), '✨ AI GENERATED COMMENT', fill=GREEN, font=font_xs)
    result_lines = [
        'Wow, 4 hours for your first',
        'marathon is amazing! All that',
        'hard work really paid off 💪',
    ]
    for i, line in enumerate(result_lines):
        draw.text((rx+20, ry+60+i*32), line, fill=WHITE, font=font_md)

    # Bottom features
    feats = [
        ('Friendly', 'Casual tone'),
        ('Professional', 'Business tone'),
        ('Enthusiastic', 'Energetic tone'),
        ('Multi-lang', 'VI / EN / auto'),
    ]
    for i, (title, desc) in enumerate(feats):
        fx = 120 + i * 280
        fy = 560
        rounded_rect(draw, [fx, fy, fx+240, fy+130], fill='#252540', radius=12, outline='#3a3a5c')
        draw.text((fx+120, fy+40), title, fill=WHITE, font=font_sm, anchor='mm')
        draw.text((fx+120, fy+70), desc, fill=GRAY, font=font_xs, anchor='mm')

    img.save(os.path.join(OUT, 'screenshot-4-ai.png'))
    print('✓ screenshot-4-ai.png')

def slide5_privacy():
    img = Image.new('RGB', (W, H), '#1a1b2e')
    draw = ImageDraw.Draw(img)

    draw.text((W//2, 100), 'Your Privacy, Our Priority', fill=WHITE, font=font_lg, anchor='mm')

    cards = [
        ('100% Local Storage', 'All data stays in your\nbrowser. Nothing sent\nto external servers.'),
        ('Your API Keys', 'AI features use YOUR\nkey directly. We never\nsee or store it.'),
        ('Minimal Permissions', 'Only facebook.com\naccess. No broad\npermissions needed.'),
        ('Manifest V3', "Built on Chrome's latest\nsecurity standard.\nNo eval(), no remote code."),
    ]

    cw, ch = 260, 220
    total = len(cards) * cw + (len(cards)-1) * 20
    sx = (W - total) // 2

    icons = ['💾', '🔑', '📋', '🛡️']
    for i, (title, desc) in enumerate(cards):
        x = sx + i * (cw + 20)
        y = 220
        rounded_rect(draw, [x, y, x+cw, y+ch], fill='#252540', radius=16, outline='#3a3a5c')
        draw.text((x + cw//2, y+40), icons[i], fill=WHITE, font=font_lg, anchor='mm')
        draw.text((x + cw//2, y+85), title, fill=WHITE, font=font_sm, anchor='mm')
        for j, line in enumerate(desc.split('\n')):
            draw.text((x + cw//2, y+120+j*22), line, fill=GRAY, font=font_xs, anchor='mm')

    # Bottom
    draw.text((W//2, 540), 'No tracking · No analytics · No ads · Open data handling', fill='#555570', font=font_md, anchor='mm')
    draw.text((W//2, 620), 'trancongthang.vn', fill=ACCENT, font=font_sm, anchor='mm')

    img.save(os.path.join(OUT, 'screenshot-5-privacy.png'))
    print('✓ screenshot-5-privacy.png')

if __name__ == '__main__':
    slide1_hero()
    slide2_popup()
    slide3_dashboard()
    slide4_ai()
    slide5_privacy()
    print(f'\nDone! Files saved to: {OUT}')
