# TOOLS.md - Local Notes (ESSENTIAL ONLY)

**Non-essential sections moved to breadcrumbs. See `memory/tools/` folder for full details.**
[[memory/tools/]]

---

## 🧠 Memory Access

**Semantic search:** `memory_search(query="...")`

**Direct read:** `memory_get(path="MEMORY.md")`

**Location:** `/workspace/memory/`

**Visual memories:** Folders with paired `.jpg` + `.md` files (`.md` is searchable, images loaded on-demand)

**Embeddings server:** nomic-embed-text-v1.5 on port 1236, context size 2048 tokens

*Full server docs: `memory/tools/nomic-embeddings-server.md`*
[[memory/tools/nomic-embeddings-server.md]]

**Visual memory protocols:** See `memory/tools/tools-visual-memory.md`
[[memory/tools/tools-visual-memory.md]]

**Memory system docs:** See `memory/tools/tools-memory.md`
[[memory/tools/tools-memory.md]]

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

*Full roles system: `memory/tools/roles-system.md`*
[[memory/tools/roles-system.md]]

---

## 📁 Obsidian Vault

**Path:** `/mnt/headless/Documents/Obsidian/Shared` ⭐ (CIFS mount from headless.local)

**⚠️ DO NOT USE:** `/Users/alex/Documents/Obsidian/Shared` - symlink doesn't work reliably

**LiveSync:** CouchDB at `http://headless.local:5984` (admin/opensesame)

**REST API:** `http://127.0.0.1:27123/` (auth: `Authorization: Bearer <key>`)

**Key folders:** `Improve/`, `Relationship/`, `Business/`, `Meta/`, `Mnemosyne/`, `OpenClaw/`

**⚠️ Never modify:** `.obsidian/workspace.json` via scripts

**🔗 Clickable Links:** `obsidian://open?vault=Shared&file=PATH%2FTO%2FFILE.md`

*Full API reference: `memory/tools/tools-obsidian.md`*
[[memory/tools/tools-obsidian.md]]

---

## 🌐 SSH / Infrastructure

**godzilla.local** (llama.cpp server): `ssh -i ~/.ssh/godzilla alex@godzilla.local`

**Server endpoint:** `http://godzilla.local:1234/v1`

**headless.local** (Obsidian, CouchDB): Access via CIFS mount at `/mnt/headless/`

*Full server management: `memory/procedures/llama-server-management.md`*
[[memory/procedures/llama-server-management.md]]

---

## 💬 Telegram

**IDs:**
- **Alex:** 119615798
- **Ams:** 943270314

**Image sending:** See `memory/tools/telegram-image-workflow.md`
[[memory/tools/telegram-image-workflow.md]]

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

*Full protocol: `memory/tools/sessions-management.md`*
[[memory/tools/sessions-management.md]]

---

## 🌤️ Weather

**Get forecast:** Browser + vision on xcweather.co.uk

*Full workflow: `memory/tools/weather-forecast.md`*
[[memory/tools/weather-forecast.md]]

---

## 🎨 Multi-Modal Tools

**Vision:** `read(path="/path/to/image.jpg")` for image understanding

**TTS:** `tts(text="...")` for text-to-speech

**Screenshot:** `/usr/sbin/screencapture -x /tmp/screenshot.png`

*Vision protocols: `memory/tools/tools-vision.md`*
[[memory/tools/tools-vision.md]]

---

## 🔧 Troubleshooting

**Context overflow:** Check `memorySearch.sources` in `openclaw.json`

*Full troubleshooting: `memory/tools/troubleshooting-context-overflow.md`*
[[memory/tools/troubleshooting-context-overflow.md]]

---

## 🛒 eBay

**Preferred:** eBay API (not yet implemented)

**Fallback:** Browser automation at `https://www.ebay.co.uk/sl/prelist`

*Full protocol: `memory/tools/ebay-listings.md`*
[[memory/tools/ebay-listings.md]]

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
