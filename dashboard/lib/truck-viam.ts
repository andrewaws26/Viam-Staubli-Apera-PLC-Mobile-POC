// Truck Viam client — browser-side WebRTC connection to truck-diagnostics machine.
// Separate client from TPS since it's a different Viam machine.

import { createRobotClient, SensorClient } from "@viamrobotics/sdk";
import type { RobotClient } from "@viamrobotics/sdk";
import { Struct } from "@bufbuild/protobuf";
import { SensorReadings } from "./types";

let _client: RobotClient | null = null;
let _connecting = false;

async function getTruckClient(): Promise<RobotClient> {
  if (_client) return _client;
  if (_connecting) {
    await new Promise((r) => setTimeout(r, 1000));
    if (_client) return _client;
    throw new Error("Connection in progress");
  }

  const host = process.env.NEXT_PUBLIC_TRUCK_VIAM_MACHINE_ADDRESS;
  const apiKeyId = process.env.NEXT_PUBLIC_TRUCK_VIAM_API_KEY_ID;
  const apiKey = process.env.NEXT_PUBLIC_TRUCK_VIAM_API_KEY;

  if (!host || !apiKeyId || !apiKey) {
    throw new Error(
      "Missing truck Viam credentials. Set NEXT_PUBLIC_TRUCK_VIAM_MACHINE_ADDRESS, " +
        "NEXT_PUBLIC_TRUCK_VIAM_API_KEY_ID, and NEXT_PUBLIC_TRUCK_VIAM_API_KEY."
    );
  }

  _connecting = true;
  try {
    _client = await createRobotClient({
      host,
      credentials: {
        type: "api-key",
        authEntity: apiKeyId,
        payload: apiKey,
      },
      signalingAddress: "https://app.viam.com:443",
      reconnectMaxAttempts: 3,
    });
    return _client;
  } catch (err) {
    _client = null;
    throw err;
  } finally {
    _connecting = false;
  }
}

export async function getTruckSensorReadings(
  componentName: string
): Promise<SensorReadings> {
  try {
    const client = await getTruckClient();
    const sensor = new SensorClient(client, componentName);
    const readings = await sensor.getReadings();
    return readings as SensorReadings;
  } catch (err) {
    _client = null;
    throw err;
  }
}

export async function sendTruckCommand(
  componentName: string,
  command: Record<string, unknown>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  try {
    const client = await getTruckClient();
    const sensor = new SensorClient(client, componentName);
    const result = await sensor.doCommand(Struct.fromJson(command as any));
    return result;
  } catch (err) {
    _client = null;
    throw err;
  }
}
