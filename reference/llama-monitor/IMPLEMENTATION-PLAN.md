# Llama Monitor - Cache Visualization Implementation Plan

**Date:** 2026-03-28  
**Based on:** Future Ideas #3 (Context Checkpoint Timeline)

## Summary

Build a "cache map" view that shows all cached prompts as compact blocks, lighting up on cache hits and fading on eviction. This is the most compatible enhancement with the existing completed-tasks stack.

## What Changes

### 1. Data Model Changes

**Current:**
- `activeSlots` - slots currently processing
- `completedSlots` - last 5 completed tasks

**New:**
- `cachedPrompts` - all prompts currently in cache (from `srv update` logs)
- Each cached prompt tracks:
  - `promptId` - the memory address (e.g., `0x7f9a3c0d5560`)
  - `tokenCount` - how many tokens
  - `checkpointCount` - how many checkpoints (e.g., `10/32`)
  - `memorySize` - MB used (e.g., `3373.475 MiB`)
  - `lastUsed` - timestamp of last cache hit
  - `isActive` - whether currently being processed

### 2. Log Parsing Changes

**New patterns to capture:**

```javascript
// Cache state summary
const cacheStateMatch = line.match(/cache state:\s+(\d+)\s+prompts,\s+([\d.]+)\s+MiB\s*\(\s*limits:\s*([\d.]+)\s+MiB,\s*(\d+)\s+tokens/);

// Individual prompt entries
const promptEntryMatch = line.match(/prompt\s+(0x[0-9a-f]+):\s+(\d+)\s+tokens,\s+checkpoints:\s+(\d+),\s+([\d.]+)\s+MiB/);

// Cache hits (restored context)
const cacheHitMatch = line.match(/restored context checkpoint.*?n_tokens\s*=\s*(\d+)/);

// Evictions (erased context)
const evictionMatch = line.match(/erased invalidated context checkpoint.*?n_tokens\s*=\s*(\d+)/);
```

### 3. UI Changes

**Block height reduction:**
- From ~60px to ~25px
- Remove progress bar for cached (non-active) prompts
- Show only: `X tokens | ✓ N/32 | X.X GB`

**Visual states:**
- **Active:** Bright green border, normal height (60px)
- **Cached (recent):** Dim green, compact (25px)
- **Cached (old):** Grey, compact (25px)
- **Cache hit:** Flash bright green for 2 seconds
- **Evicted:** Fade out animation (1 second), then disappear

**New header bar:**
```
Cache: 14 prompts, 73.0 GB / 80.0 GB (91%) | 188k token limit
```

### 4. Animation System

**Cache hit flash:**
```javascript
function flashCacheHit(promptId) {
  const element = document.getElementById(`prompt-${promptId}`);
  if (element) {
    element.classList.add('cache-hit-flash');
    setTimeout(() => element.classList.remove('cache-hit-flash'), 2000);
  }
}
```

**Eviction fade:**
```javascript
function fadeEviction(promptId) {
  const element = document.getElementById(`prompt-${promptId}`);
  if (element) {
    element.classList.add('eviction-fade');
    setTimeout(() => element.remove(), 1000);
  }
}
```

### 5. CSS Changes

```css
/* Compact prompt block */
.task.cached {
  padding: 4px 8px;
  height: 25px;
  margin-bottom: 3px;
}

.task.cached .task-header {
  margin-bottom: 0;
  font-size: 9px;
}

/* Hide progress bar for cached prompts */
.task.cached .task-bar {
  display: none;
}

/* Cache hit flash animation */
@keyframes cache-hit-flash {
  0% { background: #16213e; border-color: #4ade80; }
  50% { background: #052e16; border-color: #86efac; }
  100% { background: #16213e; border-color: #4ade80; }
}

.cache-hit-flash {
  animation: cache-hit-flash 2s ease-in-out;
  border: 2px solid #4ade80;
}

/* Eviction fade animation */
@keyframes eviction-fade {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.95); }
}

.eviction-fade {
  animation: eviction-fade 1s ease-out forwards;
}

/* Cache utilization bar */
.cache-header {
  background: #16213e;
  padding: 6px 10px;
  border-radius: 4px;
  margin-bottom: 8px;
  font-size: 10px;
  color: #94a3b8;
}

.cache-utilization {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cache-bar {
  flex: 1;
  height: 6px;
  background: #0f3460;
  border-radius: 3px;
  overflow: hidden;
}

.cache-fill {
  height: 100%;
  background: linear-gradient(to right, #4ade80, #fbbf24, #f87171);
  transition: width 0.3s;
}
```

## Implementation Order

### Phase 1: Data Tracking (30 mins)
1. Parse `srv update` logs to extract cache state
2. Build `cachedPrompts` array from prompt entries
3. Track cache hits and evictions

### Phase 2: UI Rendering (30 mins)
1. Add compact block rendering for cached prompts
2. Add cache header bar with utilization
3. Style adjustments (height, colors)

### Phase 3: Animations (20 mins)
1. Implement cache hit flash
2. Implement eviction fade
3. Test visual feedback

### Phase 4: Integration (20 mins)
1. Connect active tasks to cached prompts
2. Handle transitions (active → cached → evicted)
3. Performance testing with 14+ prompts

## Expected Result

A monitor that shows:
- **Top:** Cache utilization bar (73/80 GB, 91%)
- **Active section:** 1-4 blocks showing current processing (normal height)
- **Cached section:** 10-14 compact blocks showing cached prompts
  - Flash green when reused
  - Fade out when evicted
  - Show token count and checkpoint ratio

## Why This Works

1. **Minimal restructuring** - Keeps existing stack layout
2. **Immediate "ohhh" factor** - Seeing cache hits light up is visceral
3. **Shows the invisible** - People don't realize prompts are cached; this makes it visible
4. **Builds on existing code** - Already parse checkpoint logs, already have WebSocket updates
5. **Scalable** - Can add more features (eviction warnings, hit frequency) later

## Thread Thought
This turns the monitor from a "task tracker" into a "memory viewer." Watching those blocks light up when a cached prompt is reused? That's the moment someone goes "oh, so that's how context caching actually works." It's educational, beautiful, and genuinely useful all at once.
