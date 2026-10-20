# DISTRACT — Driver Attention & Road Safety Simulator

An interactive, cross-platform 3D first-person driving and human-factors road safety exhibition simulator built with HTML5, Three.js (WebGL 2), Express + WebSockets, and TypeScript. Designed for school science exhibitions to demonstrate how looking away from the forward roadway degrades lane keeping, hazard reaction time, and collision avoidance.

---

## 1. Local & LAN Exhibition Startup

```bash
# Install dependencies (once)
npm install

# Start the full-stack simulator & WebSocket/WebRTC signaling server on 0.0.0.0:3000
npm run dev

# Run deterministic unit tests (physics, road math, touch/wheel input, attention state machine, experiment logger)
node --test src/sim.test.ts
```

- **Single Computer**: Open `http://localhost:3000` in any modern desktop, laptop, or tablet browser.
- **Multi-Device LAN Exhibition**: The Express server binds to `0.0.0.0:3000` and automatically detects the host PC's LAN IPv4 addresses via `/api/network-info`. Note that `localhost` on the main computer is **not** accessible from other computers or phones; use the detected `http://<LAN-IP>:3000` URL or scan the generated QR codes inside **Settings → Side Displays** to open the Left and Right distraction displays on smartphones, tablets, or secondary monitors on the same Wi-Fi/LAN network.

---

## 2. Dedicated In-Game Settings & Side-Display Synchronization

Press `S` (or click **Settings** in the top bar) at any time to open the dedicated 6-section Settings modal:

1. **Display & Graphics**:
   - **Renderer & Performance Status**: Displays the active rendering backend (`WebGL 2`), browser WebGPU availability, live frame time (`ms`), and FPS. Automatically downscales internal pixel ratio if sustained frame time exceeds `28ms`.
   - **Graphics Quality Presets**: `Low` (Integrated GPU safe), `Balanced`, and `High`.
   - **Atmosphere & Time-of-Day Lighting**: `Daylight Clear`, `Sunset Dusk`, and `Night Highway`.
2. **Controls & Input**:
   - **Desktop Keyboard**: `WASD` or `Arrow Keys` to steer/accelerate/brake, `L` (or `Q`/`E`) to simulate looking away, `V` to pulse side displays.
   - **USB Steering Wheel (Gamepad API)**: Live raw axis bars, configurable Steering/Throttle/Brake axis mapping, Deadzone (`0–35%`), Sensitivity (`0.5x–2.0x`), Axis Inversion, and one-click **Calibrate Wheel Center**.
   - **Mobile & Tablet Touch Controls**: Automatic capability detection (`pointer: coarse` / `maxTouchPoints`) with simultaneous multi-touch steering wheel pad and throttle/brake pedals (`Auto-Detect`, `Always Show`, or `Always Hide`).
3. **Side Displays (Left & Right Remote Synchronization)**:
   - Independent Left (`?side=left`) and Right (`?side=right`) presentation modes with configurable pattern (`Chevron`, `Radial Rings`, `Optic Matrix`, `Sine Wave`) and intensity (`Low`, `Medium`, `High`).
   - Synchronizes via **WebRTC DataChannels** (peer-to-peer when established), backed by a lightweight **WebSocket Relay (`/ws-distract`)** and same-browser **`BroadcastChannel`**, using a single authoritative server clock and compact JSON state packets.
   - Displays live connection status (`CONNECTED`, `LAGGING`, or `DISCONNECTED`), RTT latency (`ms`), QR codes, and a **Reconnect** action.
4. **Camera & Attention Monitoring**:
   - **Simulated Mode** (default exhibition fallback) and **Local Webcam Head-Pose Tracking** (`64×48` in-memory luminance/skin-tone centroid estimation; zero video frames ever leave the browser).
5. **Audio**:
   - Procedural Web Audio synthesizer with independent Master Volume, Engine Hum, Rumble Strip, and Safety Alert toggles.
6. **Accessibility**:
   - **Reduced Motion** (disables camera shake, speed FOV warp, and hitstop) and **Colorblind-Safe High-Contrast HUD**.
