# Llama Monitor - Installation & Usage Guide

## Overview
Real-time monitoring interface for llama.cpp server, showing active tasks, completed task history, and system resources.

## Quick Start

### Start the monitor
```bash
cd /home/alex/.openclaw/workspace
node monitor-llama-web.js
```

### Access
- **HTTP:** `http://godzilla.local:8789` (or `http://localhost:8789`)
- **WebSocket:** `ws://godzilla.local:8790`

### Split-screen dashboard
```bash
node control-ui-server.js
```
Then open `http://godzilla.local:8788`

## Features

### Active Tasks
- Real-time progress bars for prompt processing
- "Estimated tokens generated" counter during generation
- Color-coded states: checkpoint (cyan), processing (yellow), generating (green)

### Completed Tasks (Last 5)
- Prompt: time / tokens | t/s
- Eval: time / tokens | t/s  
- Total: time / tokens | overall t/s (eval tokens / total time)
- Clean split layout with timing info on left, performance on right

### Resource Monitoring (bottom)
- RAM: GB used / GB total + percentage
- VRAM: GB used / GB total + percentage
- GPU Temperature: °C with 0-85°C scale
- GPU Clock: MHz with 0-1800 MHz scale
- Color-coded bars: green <60%, yellow 60-80%, red >80%

## System Service Installation

### Create service file
```bash
sudo nano /etc/systemd/system/llama-monitor.service
```

### Service content
```ini
[Unit]
Description=Llama Monitor Web Interface
After=network.target llama-server.service

[Service]
Type=simple
User=alex
WorkingDirectory=/home/alex/.openclaw/workspace
ExecStart=/usr/bin/node /home/alex/.openclaw/workspace/monitor-llama-web.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Enable and start
```bash
sudo systemctl daemon-reload
sudo systemctl enable llama-monitor
sudo systemctl start llama-monitor
```

### Check status
```bash
systemctl status llama-monitor
```

### View logs
```bash
journalctl -u llama-monitor -f
```

## Configuration

### Environment variables
- `MONITOR_PORT` - HTTP port (default: 8789)
- `MONITOR_WS_PORT` - WebSocket port (default: 8790)

### Example with custom ports
```bash
MONITOR_PORT=9000 MONITOR_WS_PORT=9001 node monitor-llama-web.js
```

## Technical Details

### Log parsing
- Reads last 500 lines from `journalctl -u llama-server`
- Extracts slot states from update_slots messages
- Captures timing stats from print_timing output
- Calculates times in reverse from tokens and t/s

### Update mechanism
- 100ms polling interval
- WebSocket broadcasts to all connected clients
- Only sends updates when data changes (hash comparison)

### Memory management
- Tracks last 10 eval speeds for average calculation
- Keeps last 5 completed tasks
- Active slots cleared when task completes

## Troubleshooting

### Monitor not showing GPU stats
Ensure nvidia-smi is accessible:
```bash
sudo nvidia-smi --query-gpu=memory.used,memory.total,temperature.gpu,clocks.current.graphics --format=csv,noheader,nounits
```

### Permission denied for journalctl
Add user to systemd-journal group:
```bash
sudo usermod -aG systemd-journal $USER
# Log out and back in
```

### Port already in use
Kill existing process or change port:
```bash
pkill -f "monitor-llama-web.js"
# Or
MONITOR_PORT=9000 node monitor-llama-web.js
```

## Future Improvements
- [ ] **Cache visualization** - Show all cached prompts, light up on cache hits, fade on eviction (see IMPLEMENTATION-PLAN.md)
- [ ] Candy cane animation for progress bar during generation
- [ ] Persistent history storage (file-based)
- [ ] Integration into llama.cpp web interface
- [ ] Configurable number of completed tasks to show
- [ ] Export history to CSV/JSON

## Ideas & Brainstorming
See [FUTURE-IDEAS.md](FUTURE-IDEAS.md) for a full list of visualization concepts, from context checkpoint timelines to token flow waterfalls.

## Thread Thought
What started as a simple monitor has become a genuinely useful tool for understanding model performance. The real-time updates and completed task history make it something you want to keep running all the time.
