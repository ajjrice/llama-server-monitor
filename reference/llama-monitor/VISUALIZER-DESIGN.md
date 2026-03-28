# Llama Server Visualization - Design Document

**Project:** Window into the Heart of Llama Server  
**Port:** 8791 (separate from existing monitor on 8789)  
**Date:** 2026-03-28

---

## Vision

A real-time visualization that shows **what llama-server is actually doing** behind the scenes - not just task progress, but the cache state, memory management, checkpoint lifecycle, and the flow of tokens through the system.

**Core metaphor:** The cache is the model's "long-term memory." This visualization shows what it remembers, what it's currently thinking about, and what it's forgetting.

---

## Architecture

### Data Sources

All data comes from `journalctl -u llama-server -n 500 --no-pager`

### Log Patterns to Parse

```javascript
// 1. Cache state summary (appears periodically)
// Example: "srv update: - cache state: 14 prompts, 73010.420 MiB (limits: 80000.000 MiB, 188160 tokens, 1337140 est)"
const cacheStateRegex = /cache state:\s+(\d+)\s+prompts,\s+([\d.]+)\s+MiB\s*\(\s*limits:\s*([\d.]+)\s+MiB,\s*(\d+)\s+tokens/;

// 2. Individual prompt entries
// Example: "srv update:    - prompt 0x7f9a3c0d5560:   52001 tokens, checkpoints: 10,  3373.475 MiB"
const promptEntryRegex = /prompt\s+(0x[0-9a-f]+):\s+(\d+)\s+tokens,\s+checkpoints:\s+(\d+),\s+([\d.]+)\s+MiB/;

// 3. Checkpoint creation
// Example: "slot update_slots: id  0 | task 279953 | created context checkpoint 8 of 32 (pos_min = 36942, pos_max = 36942, n_tokens = 36943, size = 149.626 MiB)"
const checkpointCreateRegex = /created context checkpoint\s+(\d+)\s+of\s+(\d+)\s*\(pos_min\s*=\s*(\d+),\s*pos_max\s*=\s*(\d+),\s*n_tokens\s*=\s*(\d+),\s*size\s*=\s*([\d.]+)\s+MiB\)/;

// 4. Checkpoint restoration (cache hit)
// Example: "slot update_slots: id  0 | task 279953 | restored context checkpoint (pos_min = 36507, pos_max = 36507, n_tokens = 36508, n_past = 36508, size = 149.626 MiB)"
const checkpointRestoreRegex = /restored context checkpoint\s*\(pos_min\s*=\s*(\d+),\s*pos_max\s*=\s*(\d+),\s*n_tokens\s*=\s*(\d+),\s*n_past\s*=\s*(\d+),\s*size\s*=\s*([\d.]+)\s+MiB\)/;

// 5. Checkpoint erasure (eviction)
// Example: "slot update_slots: id  0 | task 279953 | erased invalidated context checkpoint (pos_min = 37019, pos_max = 37019, n_tokens = 37020, n_swa = 0, pos_next = 36508, size = 149.626 MiB)"
const checkpointEraseRegex = /erased invalidated context checkpoint\s*\(pos_min\s*=\s*(\d+),\s*pos_max\s*=\s*(\d+),\s*n_tokens\s*=\s*(\d+)/;

// 6. Active task progress
// Example: "slot update_slots: id  0 | task 279953 | prompt processing progress, n_tokens = 36943, batch.n_tokens = 435, progress = 0.986225"
const taskProgressRegex = /slot update_slots:\s+id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+prompt processing progress,\s*n_tokens\s*=\s*(\d+),\s+batch\.n_tokens\s*=\s*(\d+),\s+progress\s*=\s*([\d.]+)/;

// 7. Task completion (timing)
// Example: "slot print_timing: id  0 | task 279953 |"
// Followed by timing stats
const taskCompleteRegex = /slot print_timing:\s+id\s+(\d+)\s+\|\s+task\s+(\d+)/;

// 8. Task release
// Example: "slot release: id  0 | task 279953 | stop processing: n_tokens = 37625, truncated = 0"
const taskReleaseRegex = /slot\s+release:\s+id\s+(\d+)\s+\|\s+task\s+(\d+)\s+\|\s+stop processing:\s*n_tokens\s*=\s*(\d+)/;

// 9. Slot selection (LRU)
// Example: "slot get_availabl: id  0 | task -1 | selected slot by LRU, t_last = 79210264159"
const slotSelectionRegex = /slot get_availabl:\s+id\s+(\d+)\s+\|\s+task\s+(-?\d+)\s+\|\s+(.*)/;

// 10. Server idle state
// Example: "srv update_slots: all slots are idle"
const serverIdleRegex = /srv\s+update_slots:\s+all slots are idle/;
```

---

## Data Model

```javascript
// Global state
let serverState = {
  // Cache state
  cache: {
    totalPrompts: 0,           // Number of cached prompts
    totalMemoryMB: 0,          // Total memory used
    memoryLimitMB: 0,          // Memory limit
    tokenLimit: 0,             // Token limit
    utilizationPercent: 0,     // Cache utilization %
    
    // Individual prompts in cache
    prompts: {
      // Key: prompt ID (e.g., "0x7f9a3c0d5560")
      // Value: {
      //   id: "0x7f9a3c0d5560",
      //   tokenCount: 52001,
      //   checkpointCount: 10,
      //   maxCheckpoints: 32,
      //   memoryMB: 3373.475,
      //   lastUsed: timestamp,
      //   isActive: false,
      //   hitCount: 0,           // How many times this prompt was hit
      //   lastHitTime: timestamp // When it was last hit
      // }
    }
  },
  
  // Active tasks
  activeTasks: {
    // Key: task ID
    // Value: {
    //   taskId: 279953,
    //   slotId: 0,
    //   state: 'processing' | 'generating' | 'checkpoint',
    //   progress: 0.0-1.0,
    //   nTokens: 36943,
    //   batchTokens: 435,
    //   startTime: timestamp,
    //   checkpointCount: 8,      // Current checkpoint position
    //   maxCheckpoints: 32
    // }
  },
  
  // Recent events (for animations)
  events: {
    // Queue of recent events for visual feedback
    cacheHits: [],      // [{ promptId, time }]
    evictions: [],      // [{ promptId, time }]
    checkpointCreates: [], // [{ taskId, checkpointNum, time }]
    completions: []     // [{ taskId, stats, time }]
  },
  
  // History (for trends)
  history: {
    cacheUtilization: [], // [{ time, percent }]
    activeTaskCount: [],  // [{ time, count }]
    cacheHitRate: []      // [{ time, hitsPerSecond }]
  }
};
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  🧠 LLAMA SERVER VISUALIZER                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CACHE UTILIZATION: 73.0 GB / 80.0 GB (91%)                    │
│  ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  14 prompts cached | 188k token limit                           │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  ACTIVE TASKS (1/4 slots)                                       │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Slot 0 - Task #279953          [processing]                │ │
│  │ Progress: 98%                                                 │ │
│  │ ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │ │
│  │ Checkpoint: 8/32                                               │ │
│  │ Tokens: 36,943 / batch: 435                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  CACHED PROMPTS (14)                                            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 0x7f9a...5560  52,001 tokens  ✓10/32  3.3 GB  [recent]    │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 0x7f99...b9a0  89,827 tokens  ✓13/32  5.1 GB              │ │
│  └────────────────────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 0x7f99...c320 113,043 tokens  ✓28/32  8.1 GB  [HOT!]      │ │  ← Flashing
│  └────────────────────────────────────────────────────────────┘ │
│  ... (more cached prompts)                                      │ │
├─────────────────────────────────────────────────────────────────┤
│  RECENT EVENTS                                                   │
│  • 12:04:13 Cache hit: prompt 0x7f99...c320                    │ │
│  • 12:04:12 Checkpoint created: task 279953 (8/32)             │ │
│  • 12:04:10 Slot 0 selected by LRU                             │ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Animation System

### Cache Hit Flash
```javascript
function handleCacheHit(promptId) {
  // Find the prompt element
  const element = document.getElementById(`prompt-${promptId.replace('0x', '')}`);
  if (!element) return;
  
  // Add flash class
  element.classList.add('cache-hit-flash');
  element.querySelector('.hit-indicator').textContent = '🔥 HOT!';
  
  // Track hit count
  const promptData = serverState.cache.prompts[promptId];
  if (promptData) {
    promptData.hitCount++;
    promptData.lastHitTime = Date.now();
  }
  
  // Store event
  serverState.events.cacheHits.push({ promptId, time: Date.now() });
  serverState.events.cacheHits = serverState.events.cacheHits.slice(-20);
  
  // Remove flash after 2 seconds
  setTimeout(() => {
    element.classList.remove('cache-hit-flash');
    element.querySelector('.hit-indicator').textContent = '';
  }, 2000);
}
```

### Eviction Fade
```javascript
function handleEviction(promptId) {
  const element = document.getElementById(`prompt-${promptId.replace('0x', '')}`);
  if (!element) return;
  
  // Add fade class
  element.classList.add('eviction-fade');
  
  // Store event
  serverState.events.evictions.push({ promptId, time: Date.now() });
  serverState.events.evictions = serverState.events.evictions.slice(-20);
  
  // Remove element after 1 second
  setTimeout(() => {
    element.remove();
    delete serverState.cache.prompts[promptId];
    updateCacheStats();
  }, 1000);
}
```

### Checkpoint Progress
```javascript
function handleCheckpointCreate(taskId, checkpointNum, maxCheckpoints) {
  // Update the active task's checkpoint indicator
  const taskElement = document.getElementById(`task-${taskId}`);
  if (taskElement) {
    const checkpointBar = taskElement.querySelector('.checkpoint-progress');
    checkpointBar.style.width = `${(checkpointNum / maxCheckpoints) * 100}%`;
    checkpointBar.textContent = `${checkpointNum}/${maxCheckpoints}`;
    
    // Flash the checkpoint bar
    checkpointBar.classList.add('checkpoint-flash');
    setTimeout(() => checkpointBar.classList.remove('checkpoint-flash'), 300);
  }
  
  // Store event
  serverState.events.checkpointCreates.push({ 
    taskId, 
    checkpointNum, 
    maxCheckpoints,
    time: Date.now() 
  });
  serverState.events.checkpointCreates = serverState.events.checkpointCreates.slice(-20);
}
```

---

## Component Rendering

### Cache Header Bar
```javascript
function renderCacheHeader() {
  const cache = serverState.cache;
  const utilization = cache.utilizationPercent;
  
  return `
    <div class="cache-header">
      <div class="cache-title">🧠 Cache Utilization</div>
      <div class="cache-stats">
        <span class="cache-usage">${cache.totalMemoryMB.toFixed(1)} GB / ${cache.memoryLimitMB.toFixed(1)} GB</span>
        <span class="cache-percent">${utilization.toFixed(0)}%</span>
        <span class="cache-prompts">${cache.totalPrompts} prompts cached</span>
        <span class="cache-limit">${(cache.tokenLimit / 1000).toFixed(0)}k token limit</span>
      </div>
      <div class="cache-bar-container">
        <div class="cache-bar">
          <div class="cache-fill" style="width: ${utilization}%"></div>
        </div>
      </div>
    </div>
  `;
}
```

### Active Task Block
```javascript
function renderActiveTask(task) {
  return `
    <div class="task-block active" id="task-${task.taskId}">
      <div class="task-header">
        <span class="task-id">Slot ${task.slotId} - Task #${task.taskId}</span>
        <span class="task-state ${task.state}">[${task.state}]</span>
      </div>
      <div class="task-progress-container">
        <div class="task-progress-label">Progress: ${(task.progress * 100).toFixed(0)}%</div>
        <div class="task-progress-bar">
          <div class="task-progress-fill" style="width: ${(task.progress * 100)}%"></div>
        </div>
      </div>
      <div class="task-checkpoint">
        <span class="checkpoint-label">Checkpoint:</span>
        <div class="checkpoint-progress-bar">
          <div class="checkpoint-progress-fill" style="width: ${(task.checkpointCount / task.maxCheckpoints) * 100}%"></div>
        </div>
        <span class="checkpoint-count">${task.checkpointCount}/${task.maxCheckpoints}</span>
      </div>
      <div class="task-tokens">
        <span>📝 ${task.nTokens.toLocaleString()} tokens</span>
        <span>📦 batch: ${task.batchTokens}</span>
      </div>
    </div>
  `;
}
```

### Cached Prompt Block (Compact)
```javascript
function renderCachedPrompt(prompt) {
  const isRecent = Date.now() - prompt.lastUsed < 60000; // Within last minute
  const isHot = prompt.hitCount > 1;
  
  return `
    <div class="prompt-block cached ${isRecent ? 'recent' : ''} ${isHot ? 'hot' : ''}" id="prompt-${prompt.id.replace('0x', '')}">
      <div class="prompt-id">${prompt.id}</div>
      <div class="prompt-tokens">${prompt.tokenCount.toLocaleString()} tokens</div>
      <div class="prompt-checkpoints">✓${prompt.checkpointCount}/${prompt.maxCheckpoints}</div>
      <div class="prompt-memory">${(prompt.memoryMB / 1000).toFixed(1)} GB</div>
      <div class="hit-indicator">${isHot ? '🔥' : ''}</div>
      <div class="prompt-age">${isRecent ? 'recent' : ''}</div>
    </div>
  `;
}
```

### Recent Events Log
```javascript
function renderEventsLog() {
  const events = [
    ...serverState.events.cacheHits.map(e => ({ type: 'hit', ...e })),
    ...serverState.events.evictions.map(e => ({ type: 'eviction', ...e })),
    ...serverState.events.checkpointCreates.map(e => ({ type: 'checkpoint', ...e })),
    ...serverState.events.completions.map(e => ({ type: 'complete', ...e }))
  ].sort((a, b) => b.time - a.time).slice(0, 10);
  
  return `
    <div class="events-log">
      <div class="events-title">⚡ Recent Events</div>
      <div class="events-list">
        ${events.map(e => {
          const time = new Date(e.time).toLocaleTimeString();
          let icon, text;
          
          switch(e.type) {
            case 'hit':
              icon = '🔥';
              text = `Cache hit: prompt ${e.promptId.substring(0, 12)}...`;
              break;
            case 'eviction':
              icon = '🗑️';
              text = `Eviction: prompt ${e.promptId.substring(0, 12)}...`;
              break;
            case 'checkpoint':
              icon = '💾';
              text = `Checkpoint created: task ${e.taskId} (${e.checkpointNum}/${e.maxCheckpoints})`;
              break;
            case 'complete':
              icon = '✅';
              text = `Task ${e.taskId} completed`;
              break;
          }
          
          return `<div class="event-item">${icon} <span class="event-time">${time}</span> ${text}</div>`;
        }).join('')}
      </div>
    </div>
  `;
}
```

---

## CSS Styling

```css
:root {
  --bg-primary: #0d1117;
  --bg-secondary: #161b22;
  --bg-tertiary: #21262d;
  --text-primary: #c9d1d9;
  --text-secondary: #8b949e;
  --accent-green: #238636;
  --accent-green-bright: #3fb950;
  --accent-yellow: #d29922;
  --accent-red: #da3633;
  --accent-blue: #58a6ff;
  --accent-purple: #a371f7;
}

*