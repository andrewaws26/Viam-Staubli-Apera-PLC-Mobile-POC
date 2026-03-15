# Running the Demo

This document explains how to demonstrate the system for a technical or non-technical audience.

## What You Need

- The Raspberry Pi 5 (already configured, plugged into power and Ethernet)
- A laptop or phone with internet access
- Access to the Vercel-hosted dashboard URL

The Pi does not need a monitor or keyboard. It runs headless. The dashboard is hosted on Vercel and does not run on the Pi.

## Starting the System

The Pi runs viam-server automatically on boot via a systemd service. No SSH, no commands, no manual steps. Plug it into power and Ethernet and wait about 30 seconds for it to boot and connect to Viam Cloud.

Open the Vercel dashboard URL in any browser. The dashboard will connect to the Pi through Viam Cloud automatically.

## What You See

The dashboard shows four status indicators in a grid.

The Vision System indicator is green and shows "OK" with a timestamp updating every 2 seconds. This is real data from the sensor module on the Pi.

The other three indicators (Robot Arm, PLC/Controller, Wire/Connection) are yellow and show "Pending" because their hardware is not connected yet.

The header shows a green dot labeled "Viam Connected". The footer shows "Live -- Viam Cloud".

## The Demo Script

### Demo 1: Live Data (Always Available)

"This dashboard is hosted on Vercel. It is reading live data from a sensor module running on the Raspberry Pi over there. The Pi is connected to Viam Cloud. The dashboard connects to the Pi through Viam's cloud API over WebRTC. No VPN, no port forwarding, no local network required.

The green indicator means the vision system's network endpoint is reachable and its service port is responding. The readings update every two seconds. The yellow indicators represent hardware we have not connected yet. When we connect the PLC and robot arm, those will turn green automatically with no code changes."

### Demo 2: Power Cycle (The Dramatic One)

This is the strongest demo. It proves the system detects real failures and recovers automatically.

"Watch the Vision System indicator. It is green right now. I am going to unplug the Pi's power cable."

Unplug the Pi.

Within a few seconds, the dashboard will detect the lost connection. The Vision System indicator will turn red. The audible alarm will fire. The alert banner will appear at the top of the screen.

Let the audience absorb this for a moment.

"The Pi just lost power. The dashboard detected it within seconds. That alarm would fire whether you are standing here or watching from a hotel room in another state. The dashboard itself is still running because it is hosted on Vercel, not on the Pi."

Now plug the Pi back in.

"I have plugged it back in. Watch the indicator."

Wait about 30 seconds. viam-server will start automatically via systemd, reconnect to Viam Cloud, and the sensor module will begin returning readings. The Vision System indicator will return to green with no manual intervention.

"The Pi rebooted, viam-server started automatically, reconnected to the cloud, and the dashboard picked up the live readings again. No SSH, no restart commands, no human intervention. That is what this system does."

### Demo 3: Mock Mode (No Hardware Needed)

If you want to demonstrate fault detection without the Pi present, run the dashboard in mock mode:

```
cd dashboard
NEXT_PUBLIC_MOCK_MODE=true npm run dev
```

Open http://localhost:3000. Faults will fire randomly every 15-20 seconds with audible alarms. Use the Demo Controls buttons to trigger faults on specific components manually.

## If Something Goes Wrong

**Dashboard loads but shows "Disconnected":** The Pi may not be running or may not have internet access. Check that the Pi is powered on and has an Ethernet cable connected. If you have SSH access, run `sudo systemctl status viam-server` to check the service.

**Dashboard loads but Vision System stays on "Loading":** The WebRTC connection may be initializing. Wait 10-15 seconds. If it does not connect, refresh the browser. If it still does not connect, the API key may have been rotated. Check the Vercel environment variables match the current API key in the Viam app.

**No alarm sound:** Browsers block autoplay audio until the user interacts with the page. Click anywhere on the dashboard before starting the demo to enable audio.
