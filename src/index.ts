#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WayblerClient } from "./waybler.js";

const email = process.env.WAYBLER_EMAIL;
const password = process.env.WAYBLER_PASSWORD;

if (!email || !password) {
  console.error(
    "Missing required env vars: WAYBLER_EMAIL and WAYBLER_PASSWORD",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "waybler-mcp",
  version: "1.0.0",
});

const client = new WayblerClient({ username: email!, password: password! });

async function ensureClient(): Promise<WayblerClient> {
  await client.ensureConnected();
  return client;
}

server.tool(
  "get_charger_state",
  "Check if vehicle is connected to charger and whether it's currently charging",
  {},
  async () => {
    try {
      const c = await ensureClient();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              connected: c.isVehicleConnected(),
              charging: c.isCharging(),
            }),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Connection failed: ${err}` }],
      };
    }
  },
);

server.tool(
  "get_pricing",
  "Get current electricity price, lowest price in next 24h, and hourly price forecast. Prices include both 'total' (incl. VAT, what users see) and 'value' (excl. VAT, for start_charging).",
  {},
  async () => {
    try {
      const c = await ensureClient();
      const current = c.getCurrentPrice();
      const forecast = c.getPriceForecast();
      const cheapest24h = c.getLowestPrice(24);
      const currency = c.getCurrency();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              currency,
              current: current
                ? {
                    total: current.consumptionFee.total,
                    value: current.consumptionFee.value,
                    valid_from: current.at,
                  }
                : null,
              cheapest_24h: cheapest24h
                ? {
                    total: cheapest24h.consumptionFee.total,
                    value: cheapest24h.consumptionFee.value,
                    time: cheapest24h.at,
                  }
                : null,
              forecast: forecast.map((e) => ({
                time: e.at,
                total: e.consumptionFee.total,
                value: e.consumptionFee.value,
              })),
            }),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Connection failed: ${err}` }],
      };
    }
  },
);

server.tool(
  "start_charging",
  "Start a charging session with a spot price limit. Charging pauses automatically when price exceeds the limit.",
  {
    spot_price_limit: z
      .number()
      .describe(
        "Max electricity price (excl. VAT). Use the 'value' field from get_pricing.",
      ),
  },
  async ({ spot_price_limit }) => {
    try {
      const c = await ensureClient();

      if (!c.isVehicleConnected()) {
        return {
          isError: true,
          content: [{ type: "text", text: "No vehicle connected" }],
        };
      }

      if (c.isCharging()) {
        return {
          isError: true,
          content: [{ type: "text", text: "Already charging" }],
        };
      }

      const result = await c.startCharging(spot_price_limit);

      if (!result) {
        return {
          isError: true,
          content: [{ type: "text", text: "Failed to start charging" }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ session_id: result.sessionId }),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: "text", text: `Failed to start charging: ${err}` }],
      };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
