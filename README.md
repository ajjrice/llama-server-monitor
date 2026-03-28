# Llama Server Monitor & Visualizer

**Real-time monitoring and visualization tools for llama.cpp inferencing servers**

![GitHub license](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)
![GitHub stars](https://img.shields.io/github/stars/ajjrice/llama-server-monitor.svg?style=social&label=Star)

---

## Overview

Two complementary tools for understanding what your llama.cpp server is actually doing:

1. **Monitor** (port 8789) - Real-time performance tracking
2. **Visualizer** (port 8791) - Window into the cache internals

The **monitor** answers "How is my server performing?" with active task tracking, completed task history, and resource utilization (RAM, VRAM, GPU temp/clock).

The **visualizer** answers "What is my server actually doing?" by showing cache state, checkpoint lifecycle, and real-time cache hits/evictions.

---

## Why This Exists

> "It IS really hard to understand what llama-server is doing behind the scenes. I don't think I've ever seen a visualisation of what an inferencing server actually DOES"

Most LLM server monitoring focuses on metrics (tokens/sec, queue length, memory usage). These tools show you the **internals** - how prompts get cached, how checkpoints are created and restored, how the LRU eviction actually works.

When you see a cache hit flash green, you understand context caching. When you watch evictions fade out, you understand memory pressure.

---

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- llama-server running as systemd service (`llama-server.service`)
- `sudo` access for reading journalctl logs

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/llama-server-monitor.git
cd llama-server-monitor

# Install dependencies
npm install

# Run the monitor
node monitor-llama-web.js

# Run the visualizer
node llama-server-visualizer.js
```

### Access

- **Monitor:** http://localhost:8789
- **Visualizer:** http://localhost:8791

### Systemd Services (Optional)

For production use, install as systemd services:

```bash
# Copy service files
sudo cp llama-monitor.service /etc/systemd/system/
sudo cp llama-server-visualizer.service /etc/systemd/system/

# Enable and start
sudo systemctl enable llama-monitor
sudo systemctl enable llama-server-visualizer
sudo systemctl start llama-monitor
sudo systemctl start llama-server-visualizer
```

---

## Screenshots

### Monitor (Port 8789)

Real-time performance tracking with active tasks, completed task history, and resource monitoring:

![Llama Monitor](screenshots/monitor.png)

**What You See:**
- **Active Tasks** - Real-time progress bars showing current inference jobs
- **Completed Tasks** - Last 5 jobs with detailed timing (prompt/eval/overall t/s)
- **Resource Bars** - RAM, VRAM, GPU temperature, and clock speed with color-coded usage
- **Relative Timestamps** - "2m ago", "45s ago" to show when tasks completed

### Visualizer (Port 8791)

Window into cache internals with real-time animations:

![Llama Visualizer](screenshots/visualizer.png)

**What You See:**
- **Cache Utilization** - Total memory used vs limit with gradient bar
- **All Cached Prompts** - Every prompt in cache with token counts and checkpoint ratios
- **Checkpoint Progress** - Real-time checkpoint creation (0-32) for active tasks
- **Recent Events Log** - Live feed of cache hits, evictions, and completions

**Animations (Not Visible in Static Images):**
- 🔥 **Cache Hits** - Prompt blocks flash bright green for 2 seconds
- 🗑️ **Evictions** - Prompt blocks fade out over 1 second when removed from cache
- 💾 **Checkpoints** - Progress bars fill smoothly as checkpoints are created

---

## Features

### Monitor (8789)

- **Active Tasks:** Real-time progress bars for all running tasks
- **Completed Tasks:** Last 5 tasks with prompt/eval/total tokens per second
- **Resource Monitoring:**
  - RAM usage (color-coded: green <60%, yellow 60-80%, red >80%)
  - VRAM usage
  - GPU temperature
  - GPU clock speed
- **WebSocket Updates:** 100ms polling for real-time updates

### Visualizer (8791)

- **Cache Utilization:** Memory usage vs limit with gradient bar
- **All Cached Prompts:** Not just last 5 - ALL prompts in cache
- **Cache Hit Visualization:** Prompts flash green for 2 seconds when reused
- **Eviction Animation:** Prompts fade out over 1 second when removed
- **Checkpoint Progress:** Shows checkpoint creation in real-time (0-32)
- **Active Task Tracking:** Full task state with progress and checkpoint bars
- **Recent Events Log:** Real-time feed of cache hits, evictions, completions
- **HOT Indicators:** Prompts used multiple times get 🔥 indicator

---

## Screenshots

### Monitor

The monitor shows active tasks at the top, completed tasks with timing stats, and resource bars at the bottom:

```
┌─────────────────────────────────────────┐
│ ⚡ Active Tasks                         │
│ ┌──────────────────────────────────┐   │
│ │ Slot 0 - Task #123               │   │
│ │ Progress: 87%                    │   │
│ │ Checkpoint: 10/32                │   │
│ │ 📝 45,231 tokens | 📦 batch: 512│   │
│ └──────────────────────────────────┘   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ ✅ Completed Slots (Last 5)             │
│ ┌──────────────────────────────────┐   │
│ │ 2m ago | 1,234 tokens            │   │
│ │ Prompt: 156 t/s | Eval: 42 t/s   │   │
│ └──────────────────────────────────┘   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 💾 Resources                            │
│ RAM: 32.4 GB / 64.0 GB [████░░░] 51%   │
│ VRAM: 22.1 GB / 24.0 GB [██████░] 92%  │
│ GPU Temp: 68°C [███░░░░] 45%            │
│ GPU Clock: 1515 MHz [████░░░] 62%      │
└─────────────────────────────────────────┘
```

### Visualizer

The visualizer shows cache internals with animations:

```
┌─────────────────────────────────────────┐
│ 💾 Cache Utilization                    │
│ 73.0 GB / 80.0 GB [████████░░] 91%      │
│ 14 prompts | 188k token limit           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 🗂️  Cached Prompts                      │
│ 0x7f9a3c0d5560... 52,001 tokens ✓10/32 │
│ 0x7f9a3c0d6678... 1,234 tokens  ✓5/32  │
│ 0x7f9a3c0d7789... 8,765 tokens  ✓12/32 🔥 HOT!│
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 📡 Recent Events                        │
│ 🔥 14:23:45 Cache hit: 52,001 tokens    │
│ 💾 14:23:44 Checkpoint: task 123 (10/32)│
│ ✅ 14:23:42 Task 122 completed          │
│ 🗑️  14:23:40 Eviction: 1,234 tokens     │
└─────────────────────────────────────────┘
```

---

## Architecture

Both tools parse `journalctl -u llama-server` output to extract real-time state:

```
┌─────────────────┐
│ llama-server    │
│ (systemd)       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ journalctl      │
│ -n 500          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Parse Logs      │
│ (regex patterns)│
└────────┬────────┘
         │
         ├──────────────┐
         │              │
         ▼              ▼
┌──────────────┐  ┌──────────────┐
│ Monitor      │  │ Visualizer   │
│ (8789)       │  │ (8791)       │
│ Performance  │  │ Internals    │
└──────────────┘  └──────────────┘
         │              │
         ▼              ▼
┌──────────────┐  ┌──────────────┐
│ WebSocket    │  │ WebSocket    │
│ (8790)       │  │ (8792)       │
└──────────────┘  └──────────────┘
         │              │
         ▼              ▼
┌──────────────┐  ┌──────────────┐
│ Browser      │  │ Browser      │
│ (HTML/JS)    │  │ (HTML/JS)    │
└──────────────┘  └──────────────┘
```

### Key Log Patterns Parsed

```javascript
// Cache state
/cache state:\s+(\d+)\s+prompts,\s+([\d.]+)\s+MiB/

// Prompt entries
/prompt\s+(0x[0-9a-f]+):\s+(\d+)\s+tokens,\s+checkpoints:\s+(\d+)/

// Checkpoint events
/created context checkpoint\s+(\d+)\s+of\s+(\d+)/
/restored context checkpoint\s*\(pos_min\s*=\s*(\d+)/
/erased invalidated context checkpoint/

// Task progress
/slot update_slots:\s+id\s+(\d+)\s+\|\s+task\s+(\d+)/

// Timing stats
/prompt eval time\s*=\s*(\d+\.?\d*)\s*ms\s*\/\s*(\d+)\s*tokens/
/eval time\s*=\s*(\d+\.?\d*)\s*ms\s*\/\s*(\d+)\s*tokens/
```

---

## Development

### Adding New Features

See `reference/llama-monitor/FUTURE-IDEAS.md` for 8+ visualization concepts:

1. **Token Flow Animation** - Visualize token generation as flowing particles
2. **Context Window Heatmap** - Show which parts of context are accessed most
3. **KV Cache Inspector** - Deep dive into key-value cache structure
4. **Prompt Dependency Graph** - Show relationships between cached prompts
5. **GPU Memory Map** - Visualize how VRAM is allocated
6. **Queue Visualization** - See pending tasks in real-time
7. **Latency Distribution** - Track response time patterns
8. **Checkpoint Timeline** - Show checkpoint creation/eviction over time

### Running Locally

```bash
# Development mode with auto-reload
npm run dev

# Run both tools simultaneously
npm run all
```

### Debugging

Enable verbose logging:

```bash
DEBUG=true node monitor-llama-web.js
DEBUG=true node llama-server-visualizer.js
```

---

## Configuration

Both tools support environment variables:

### Monitor

```bash
PORT=8789              # HTTP server port
WS_PORT=8790           # WebSocket server port
POLL_INTERVAL=100      # Polling interval in ms
```

### Visualizer

```bash
PORT=8791              # HTTP server port
WS_PORT=8792           # WebSocket server port
POLL_INTERVAL=100      # Polling interval in ms
```

---

## Contributing

Contributions welcome! Areas we're looking for help:

- **Upstream Integration:** Work with llama.cpp team to integrate as official monitoring
- **Additional Metrics:** Add more performance indicators
- **Better Animations:** Improve visual feedback
- **Mobile Responsive:** Make interfaces work on phones/tablets
- **Historical Data:** Add persistence and trend analysis

---

## License

MIT License - see [LICENSE](LICENSE) for details

---

## Acknowledgments

- Built for [llama.cpp](https://github.com/ggerganov/llama.cpp) by Georgi Gerganov
- Inspired by the need to understand LLM server internals
- Tested on NVIDIA RTX 3090 (24GB VRAM)

---

## Author

**Alex**  
GitHub: [@ajjrice](https://github.com/ajjrice)

---

> "The monitor watches performance, the visualizer watches the mind. Together they give complete visibility into the inferencing server."

---

## Changelog

### 0.1.0 (2026-03-28)

- Initial release
- Monitor with active task tracking and resource monitoring
- Visualizer with cache state visualization
- Real-time WebSocket updates
- Systemd service files for production deployment
