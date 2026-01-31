interface LoginResponse {
  token: string;
}

interface ConsumptionFee {
  currency: string;
  vat: number;
  value: number;
  total: number;
}

export interface PriceListEntry {
  at: string;
  consumptionFee: ConsumptionFee;
}

type StationState = "EvConnected" | "Busy" | "Ok" | "Unknown";

interface Station {
  stationId: number;
  name: string;
  state: StationState;
}

interface StationGroup {
  stations: Station[];
  name: string;
}

interface ChargeZoneModel {
  modelType: "ChargeZoneModel";
  zoneId: number;
  name: string;
  contractUserId: number;
  stationGroups: StationGroup[];
  isVariablePriceZone: boolean;
  spotPriceLimit: number | null;
  priceList: PriceListEntry[];
  currency: string;
  [key: string]: unknown;
}

interface CreateChargeSessionRequest {
  modelType: "CreateChargeSessionRequest";
  stationId: number;
  contractUserId: number;
  spotPriceLimit: number;
}

interface CreateChargeSessionResponse {
  modelType: "CreateChargeSessionResponse";
  result: string;
  contractUserId: string;
  sessionId: number;
}

const BASE_URL = "https://api.waybler.com/v7";
const APP_UUID = "8d0a2cfa-4373-43e2-951a-8bff7c25d4d7";

export class WayblerClient {
  private token: string | null = null;
  private tokenExp: number | null = null;
  private userId: string | null = null;
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private chargeZones: Map<number, ChargeZoneModel> = new Map();
  private reconnecting = false;

  constructor(private config: { username: string; password: string }) {}

  async ensureConnected(): Promise<void> {
    if (this.isSessionValid() && this.wsConnected) {
      return;
    }
    await this.reconnect();
  }

  isVehicleConnected(): boolean {
    for (const zone of this.chargeZones.values()) {
      for (const group of zone.stationGroups) {
        for (const station of group.stations) {
          if (station.state === "EvConnected" || station.state === "Busy") {
            return true;
          }
        }
      }
    }
    return false;
  }

  isCharging(): boolean {
    for (const zone of this.chargeZones.values()) {
      for (const group of zone.stationGroups) {
        for (const station of group.stations) {
          if (station.state === "Busy") return true;
        }
      }
    }
    return false;
  }

  getCurrentPrice(): PriceListEntry | null {
    const now = new Date();

    for (const zone of this.chargeZones.values()) {
      for (const entry of zone.priceList) {
        const entryTime = new Date(entry.at);
        const entryEnd = new Date(entryTime.getTime() + 60 * 60 * 1000);
        if (now >= entryTime && now < entryEnd) {
          return entry;
        }
      }
    }
    return null;
  }

  getLowestPrice(lookAheadHours: number): PriceListEntry | null {
    const now = new Date();
    const cutoff = new Date(now.getTime() + lookAheadHours * 60 * 60 * 1000);

    let lowest: PriceListEntry | null = null;

    for (const zone of this.chargeZones.values()) {
      for (const entry of zone.priceList) {
        const entryTime = new Date(entry.at);
        if (entryTime >= now && entryTime <= cutoff) {
          if (
            !lowest ||
            entry.consumptionFee.total < lowest.consumptionFee.total
          ) {
            lowest = entry;
          }
        }
      }
    }

    return lowest;
  }

  getPriceForecast(): PriceListEntry[] {
    const now = new Date();
    const forecast: PriceListEntry[] = [];

    for (const zone of this.chargeZones.values()) {
      for (const entry of zone.priceList) {
        const entryTime = new Date(entry.at);
        if (entryTime >= now) {
          forecast.push(entry);
        }
      }
    }

    return forecast.sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
    );
  }

  getCurrency(): string | null {
    for (const zone of this.chargeZones.values()) {
      return zone.currency;
    }
    return null;
  }

  async startCharging(
    spotPriceLimit: number,
  ): Promise<CreateChargeSessionResponse | null> {
    for (const zone of this.chargeZones.values()) {
      for (const group of zone.stationGroups) {
        for (const station of group.stations) {
          if (station.state === "EvConnected") {
            const body: CreateChargeSessionRequest = {
              modelType: "CreateChargeSessionRequest",
              stationId: station.stationId,
              contractUserId: zone.contractUserId,
              spotPriceLimit,
            };
            const res = await this.apiFetch(`/${this.userId}/sessions/charge`, {
              method: "PUT",
              body: JSON.stringify(body),
            });
            return (await res.json()) as CreateChargeSessionResponse;
          }
        }
      }
    }
    return null;
  }

  disconnect(): void {
    this.wsConnected = false;
    this.ws?.close();
    this.ws = null;
  }

  private isSessionValid(): boolean {
    if (!this.token || !this.tokenExp) return false;
    // Add 60s buffer before expiration
    return Date.now() < this.tokenExp * 1000 - 60_000;
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;

    try {
      this.disconnect();
      this.chargeZones.clear();
      await this.login();
      await this.connectWebSocket();
    } finally {
      this.reconnecting = false;
    }
  }

  private async login(): Promise<void> {
    const res = await this.apiFetch(
      "/app/authenticate/login",
      {
        method: "POST",
        body: JSON.stringify({
          email: this.config.username,
          password: this.config.password,
        }),
      },
      false,
    );

    const data = (await res.json()) as LoginResponse;
    this.token = data.token;

    const parsed = this.parseToken(data.token);
    this.userId = parsed.userId;
    this.tokenExp = parsed.exp;

    if (!this.userId) {
      throw new Error("Could not parse user ID from token.");
    }
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("WebSocket init timeout")),
        30000,
      );

      const url = `wss://api.waybler.com/v7/app/websocket?jwt=${this.token}&app-uuid=${APP_UUID}`;
      this.ws = new WebSocket(url);

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          if (!msg?.modelType) return;

          if (msg.modelType === "ChargeZoneModel") {
            this.chargeZones.set(msg.zoneId, msg as ChargeZoneModel);
          } else if (msg.modelType === "ChargeZoneUpdatedEvent") {
            const zone = msg.chargeZone as ChargeZoneModel;
            this.chargeZones.set(zone.zoneId, zone);
          } else if (msg.modelType === "WebsocketInitMessage") {
            clearTimeout(timeout);
            this.wsConnected = true;
            resolve();
          }
        } catch {
          // Ignore parse errors
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        this.wsConnected = false;
        reject(new Error("WebSocket connection error"));
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        clearTimeout(timeout);
      };
    });
  }

  private async apiFetch(
    endpoint: string,
    options: RequestInit,
    auth = true,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    headers.set("x-app-uuid", APP_UUID);
    if (auth) headers.set("Authorization", `Bearer ${this.token}`);
    if (options.body)
      headers.set("Content-Type", "application/json; charset=utf-8");

    const res = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }
    return res;
  }

  private parseToken(token: string): {
    userId: string | null;
    exp: number | null;
  } {
    try {
      const payload = JSON.parse(
        atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
      );
      return {
        userId:
          payload[
            "http://schemas.microsoft.com/ws/2008/06/identity/claims/userdata"
          ] ?? null,
        exp: payload.exp ?? null,
      };
    } catch {
      return { userId: null, exp: null };
    }
  }
}
