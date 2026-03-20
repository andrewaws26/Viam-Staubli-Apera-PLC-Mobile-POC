// Viam sensor readings — fetched via server-side API route.
//
// Credentials are stored in Vercel server-side env vars (VIAM_API_KEY, etc.)
// and NEVER sent to the browser.  The browser calls /api/sensor-readings
// which proxies the request through Next.js API routes (Vercel serverless
// functions).  This is production-safe for public-facing dashboards.

import { SensorReadings } from "./types";

export class ComponentNotFoundError extends Error {
  constructor(componentName: string) {
    super(`Component "${componentName}" not configured on this machine`);
    this.name = "ComponentNotFoundError";
  }
}

export async function getSensorReadings(
  componentName: string
): Promise<SensorReadings> {
  const url = `/api/sensor-readings?component=${encodeURIComponent(componentName)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    // Network error (Vercel down, DNS failure, etc.)
    throw new Error(
      `Network error fetching sensor readings: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (response.status === 404) {
    // Component not configured on the machine yet
    throw new ComponentNotFoundError(componentName);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sensor read failed (${response.status}): ${body}`);
  }

  return (await response.json()) as SensorReadings;
}
