# TOOLS.md - Local Notes (ESSENTIAL ONLY)

**Non-essential sections moved to breadcrumbs.** See `memory/tools/` folder for full details.

---

## 📝 Linking Convention

**Internal `.md` file links:** Use wikilink format without backticks for Obsidian compatibility.
- ✅ Preferred: `[[memory/tools/sessions-management.md]]`
- ❌ Avoid: `` `[[memory/tools/file.md]]` `` (backticks around wikilinks break them)
- ❌ Avoid: `memory/tools/file.md` (plain text, not clickable)

**Code/tool references:** Use backticks for commands, APIs, and non-file references.
- ✅ `memory_search(query="...")`
- ✅ `http://godzilla.local:1234/v1`
- ✅ `` `/mnt/headless/Documents/Obsidian/Shared` `` (file paths as code)

---

## 🧠 Memory Access

**Semantic search:** `memory_search(query="...")`

**Direct read:** `memory_get(path="MEMORY.md")`

**Location:** `/workspace/memory/`

**Visual memories:** Folders with paired `.jpg` + `.md` files (`.md` is searchable, images loaded on-demand)

**Embeddings server:** nomic-embed-text-v1.5 on port 1236, context size 2048 tokens

*Full server docs:* [[memory/tools/nomic-embeddings-server.md]]

**Visual memory protocols:** [[memory/tools/tools-visual-memory.md]]

**Memory system docs:** [[memory/tools/tools-memory.md]]

---

## 🌡️ Temperature Profiles

**Temperature variants for the 27b model:**

| Temp | Alias | Use Case |
|------|-------|----------|
| `t040` | tools | Tool calls, structured output, precise tasks |
| `t060` | balanced | General assistance, daily tasks (DEFAULT) |
| `t070` | excitable | Slightly more creative, still reliable |
| `t080` | creative | Chatting, brainstorming, philosophical discussions |
| `t090` | wild | Maximum creativity, experimental |

**How to use:**
```python
session_status(model="llamacpp-27b-t080")  # Creative mode
session_status(model="llamacpp-27b-t040")  # Tools mode
session_status(model="llamacpp-27b-t060")  # Balanced (default)
```

**Role temperature mapping:**
- **Mnemosyne** (GTD) → `t080` (creative)
- **Astrea** (Research) → `t040` (tools)
- **Janus** (Role creation) → `t080` (creative)
- **Ariadne** (default) → `t060` (balanced)

*Full roles system:* [[memory/tools/roles-system.md]]

---

## 📁 Obsidian Vault

**Path:** `/mnt/headless/Documents/Obsidian/Shared` ⭐ (CIFS mount from headless.local)

**⚠️ DO NOT USE:** `/Users/alex/Documents/Obsidian/Shared` - symlink doesn't work reliably

**LiveSync:** CouchDB at `http://headless.local:5984` (admin/opensesame)

**REST API:** `http://127.0.0.1:27123/` (auth: `Authorization: Bearer <key>`)

**Key folders:** `Improve/`, `Relationship/`, `Business/`, `Meta/`, `Mnemosyne/`, `OpenClaw/`

**⚠️ Never modify:** `.obsidian/workspace.json` via scripts

**🔗 Clickable Links:** `obsidian://open?vault=Shared&file=PATH%2FTO%2FFILE.md`

*Full API reference:* [[memory/tools/tools-obsidian.md]]

---

## 🌐 SSH / Infrastructure

**godzilla.local** (llama.cpp server): `ssh -i ~/.ssh/godzilla alex@godzilla.local`

**Server endpoint:** `http://godzilla.local:1234/v1`

**headless.local** (Obsidian, CouchDB): Access via CIFS mount at `/mnt/headless/`

---

## 🌐 Browser Tool (Chromium)

**Status:** ✅ Working (April 17, 2026)

**Setup:**
```bash
/usr/bin/chromium --headless --no-sandbox --disable-gpu --remote-debugging-port=18800 --user-data-dir=/tmp/chromium-openclaw &
```

**Details:**
- Chromium must be running with CDP (Chrome DevTools Protocol) on port 18800
- Browser tool auto-detects `/usr/bin/chromium` but needs it running first
- Headless mode works fine without X11 (uses Ozone platform)
- Add `--no-sandbox` for headless/server environments

**If browser tool times out:**
1. Check if Chromium is running: `pgrep -a chromium`
2. Start it manually with command above
3. Verify CDP: `curl http://127.0.0.1:18800/json/version`
4. Restart OpenClaw gateway if needed

**Why this matters:** Browser tool expects CDP server to be available. Unlike Chrome on macOS/Linux desktop, headless Chromium on servers needs explicit startup with `--remote-debugging-port`.

*Full server management:* [[memory/procedures/llama-server-management.md]]

---

## 💾 Storage & External Drives

### Internal Drive (godzilla.local)
- **Device:** `/dev/sda1` (TOSHIBA THNSNJ128GCSU)
- **Size:** 113.2 GB ext4
- **Mounted:** `/` (root)
- **Status:** ⚠️ 93% full (7.6 GB available)

### External Drive
- **Label:** `Untitled`
- **Device:** `/dev/sdb2` (APPLE HDD HTS541010A9E662)
- **Size:** 931.3 GB exFAT
- **Mount point:** `/media/Untitled`
- **Contents:** `models/` folder (LLM checkpoints)
- **Serial:** `J88000D802KKKB`

---

## 💬 Telegram

**IDs:**
- **Alex:** 119615798
- **Ams:** 943270314

**Image sending:** [[memory/tools/telegram-image-workflow.md]]

---

## 🕐 Timezone

- **Europe/London**
- **Active window:** 12:00–03:00

---

## 🔄 Sessions & Subagents

**Spawn subagents:** `sessions_spawn(task="...", label="...", model="llamacpp-27b-t0X0")`

**List sessions:** `sessions_list(limit=10)`

**Read transcript:** `sessions_history(sessionKey="...")`

**Agent-to-agent:** `sessions_send(message="...", sessionKey="agent:main:main")`

*Full protocol:* [[memory/tools/sessions-management.md]]

---

## 🌤️ Weather

**Get forecast:** Browser + vision on xcweather.co.uk

*Full workflow:* [[memory/tools/weather-forecast.md]]

---

## 🎨 Multi-Modal Tools

**Vision:** `read(path="/path/to/image.jpg")` for image understanding

**TTS:** `tts(text="...")` for text-to-speech

**Screenshot:** `/usr/sbin/screencapture -x /tmp/screenshot.png`

*Vision protocols:* [[memory/tools/tools-vision.md]]

---

## 🔧 Troubleshooting

**Context overflow:** Check `memorySearch.sources` in `openclaw.json`

*Full troubleshooting:* [[memory/tools/troubleshooting-context-overflow.md]]

---

## 🛒 eBay

**Preferred:** eBay API (not yet implemented)

**Fallback:** Browser automation at `https://www.ebay.co.uk/sl/prelist`

*Full protocol:* [[memory/tools/ebay-listings.md]]

---

## 💡 Inverted Cost Model

**Alex self-hosts with 3090 GPU → maximize utilization, not minimize tokens**

- Idle GPU = wasted investment
- Active GPU = extracting value
- Background work during idle time = good
- Heavy context windows = fine

*Full philosophy: See USER.md → "Inverted Cost Model"*

---

*Full versions archived in `memory/tools/` breadcrumbs to save ~2000 tokens in context window*
