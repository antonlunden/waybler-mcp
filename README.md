# Waybler MCP Server

A Model Context Protocol (MCP) server for Waybler EV charging. Check charger status, monitor electricity prices, and start smart charging sessions — from your AI assistant.

**Tools:**

| Tool | Description |
|------|-------------|
| `get_charger_state` | Check if vehicle is connected and charging status |
| `get_pricing` | Current price, lowest price in next 24h, and hourly forecast |
| `start_charging` | Start charging with a spot price limit |

## Usage

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "waybler": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "WAYBLER_EMAIL", "-e", "WAYBLER_PASSWORD", "ghcr.io/antonlunden/waybler-mcp"],
      "env": {
        "WAYBLER_EMAIL": "your-email@example.com",
        "WAYBLER_PASSWORD": "your-password"
      }
    }
  }
}
```

| Variable | Required | Description |
|----------|----------|-------------|
| `WAYBLER_EMAIL` | Yes | Email for your Waybler account |
| `WAYBLER_PASSWORD` | Yes | Password for your Waybler account |

## Disclaimer

This project is not affiliated with or endorsed by Waybler.
