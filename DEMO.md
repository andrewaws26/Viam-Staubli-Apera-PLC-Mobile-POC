# Running the Demo

This document explains how to demonstrate the system for a non-technical audience.

## What You Need

- The Raspberry Pi 5 (already configured, plugged into power and network)
- A laptop or phone on the same network (or any internet connection for cloud mode)
- The Pi's IP address (currently 192.168.1.89)

## Starting the System

The Pi runs viam-server automatically on boot. No action is needed for the sensor pipeline.

To start the dashboard, SSH into the Pi and run:

```
cd /home/andrew/Viam-Staubli-Apera-PLC-Mobile-POC/dashboard
npm run dev
```

Open a browser on your laptop and go to `http://192.168.1.89:3000`.

## What You See

The dashboard shows four status indicators in a grid. The Vision System indicator is green and shows "OK" with a timestamp updating every 2 seconds. The other three indicators (Robot Arm, PLC/Controller, Wire/Connection) are yellow and show "Pending" because their hardware is not connected yet.

The header shows a green dot labeled "Viam Connected". The footer shows "Live -- Viam Cloud".

## The Demo Script

**For the current state (vision sensor only):**

"This dashboard is reading live data from a sensor module running on the Raspberry Pi behind me. The Pi is connected to Viam Cloud. The dashboard in this browser is pulling sensor readings through Viam's cloud API in real time. The green indicator means the vision system's network endpoint is reachable and its service port is responding. The yellow indicators represent hardware we have not connected yet. When we connect the PLC and robot arm, those will turn green automatically."

**For the wire pull demo (when PLC hardware is connected):**

"Watch the Wire/Connection indicator. It is green right now. I am going to pull this cable out of the junction box."

Pull the wire.

"The indicator just turned red. You heard the alarm. The dashboard detected the failure within two seconds. That alert would fire whether you are standing here or watching from a hotel room in another state. That is what this system does: pull a wire, watch the dashboard react."

## If Something Goes Wrong

If the dashboard shows "Disconnected" in the header, viam-server may have stopped. SSH into the Pi and run `sudo systemctl restart viam-server`, then refresh the browser.

If the dashboard does not load at all, the Next.js dev server may not be running. SSH in and start it with `npm run dev` from the dashboard directory.
