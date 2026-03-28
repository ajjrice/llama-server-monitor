# Llama Server Visualizer - Built! (2026-03-28 12:55 GMT)

## ✅ Complete and Running

**Access:** http://godzilla.local:8791  
**WebSocket:** ws://godzilla.local:8792  
**File:** `/home/alex/.openclaw/workspace/llama-server-visualizer.js`

---

## What It Shows

### 1. Cache Utilization Header
- **Total memory used** vs limit (e.g., "73.0 GB / 80.0 GB")
- **Utilization percentage** with color-coded bar
- **Number of cached prompts**
- **Token limit** display

### 2. Active Tasks Section
Shows all currently running tasks with:
- Slot ID and task number
- State (processing/generating)
- Progress bar
- Checkpoint progress (0-32)
- Token count and batch size

### 3. Cached Prompts Section
Shows ALL prompts currently in cache (not just last 5):
- Prompt ID (truncated)
- Token count
- Checkpoint ratio (e.g., "✓10/32")
- Memory usage in GB
- **🔥 HOT indicator** for frequently accessed prompts
- **Recent tag** for prompts used in last minute
- **Flash animation** on cache hits (glows green for 2 seconds)
- **Fade animation** on evictions

### 4. Recent Events Log
Real-time event feed showing:
- 🔥 Cache hits
- 🗑️ Evictions
- 💾 Checkpoint creations
- ✅ Task completions
- 🔀 Slot selections

---

## How It Works

### Log Parsing
Reads `journalctl -u llama-server -n 500` and extracts:
- Cache state summaries
- Individual prompt entries (with memory addresses)
- Checkpoint creation/restoration/erasure events
- Task progress and state changes
- Slot selection events
- Task completion timing

### Real-Time Updates
- **100ms polling** of journalctl
- **WebSocket broadcast** to all connected clients
- **Smart change detection** - only updates when state changes

### Visual Feedback
- **Cache hits** flash green for 2 seconds
- **Evictions** fade out over 1 second
- **Progress bars** update smoothly
- **Checkpoint bars** fill as checkpoints are created

---

## Why This Is Cool

### You Can Actually SEE The Cache Working
When a prompt is reused (cache hit), its block **lights up green**. This is the moment you understand context caching - you can see the model "remembering" previous conversations.

### You Can See Evictions Happening
When the cache fills up, old prompts **fade out and disappear**. This shows the LRU (Least Recently Used) eviction in real-time.

### You Can See Checkpoint Creation
As a task processes, you can watch the checkpoint bar fill from 0/32 to 32/32. This is the model building its "memory" of the conversation.

### It's Educational
Watching this interface makes you understand what's actually happening inside llama-server:
- Prompts get cached with checkpoints
- Reused prompts skip processing (cache hits)
- Old prompts get evicted when memory is full
- Slots are selected using LRU algorithm

---

## Thread Thought

This is what I meant when I said "window into the heart of llama-server." It's not just monitoring - it's **visualization of the invisible**. 

The first time someone sees a cache hit flash green, they'll go "ohhh, THAT'S how context caching works." It turns abstract concepts into something you can actually watch happening.

The original monitor on 8789 stays untouched (it's beautiful as-is). This is a new tool for a new purpose: understanding the internals, not just tracking performance.

Two monitors, two purposes:
- **8789** = "How is my server performing?"
- **8791** = "What is my server actually doing?"

Both are now running, both are useful, both are yours.

---

## Next Steps (If You Want)

1. **Install as service** (like the monitor):
   ```bash
   sudo cp llama-server-visualizer.service /etc/systemd/system/
   sudo systemctl enable llama-server-visualizer
   sudo systemctl start llama-server-visualizer
   ```

2. **Add to dashboard-launcher.html** for split-screen viewing

3. **Build the full visualization suite** from FUTURE-IDEAS.md

---

**Session Complete:** 10:00-12:55 GMT (~3 hours)  
**Files Created:** 2 scripts, 5 docs, 1 service  
**Backups:** 15+ versions  
**Alex's Reaction:** "go!" → building mode activated 🔥

📁 Working directories:
- [reference/llama-monitor](file:///home/alex/.openclaw/workspace/reference/llama-monitor/)
- [workspace](file:///home/alex/.openclaw/workspace/)
