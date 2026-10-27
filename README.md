## Credits

Stormths is inspired by the **2D Weather Sandbox** by **Niels Daemen (niels747)**.
His project showed what a real-time atmosphere simulation in the browser
could look like — go check it out and give it a star:
https://github.com/niels747/2D-Weather-Sandbox

Stormths is an independent project written from scratch.
It is not affiliated with or endorsed by Niels Daemen


# Stormths

A 2D atmospheric sandbox that runs in the browser on the GPU (WebGL2).
Simulates air flow, temperature and buoyancy on a vertical cross-section
of the atmosphere, with automatic quality for low-end computers.

## Play

▶ https://thatdudemax1.github.io/stormths/code/

To run it locally:

    cd code
    python -m http.server 8000

Then open http://localhost:8000

## Controls
- Left drag: heat
- Right drag: cool
- Shift + drag: smoke
- Middle drag: push air
- H: toggle ground heating
- V: cycle view (temperature / smoke / velocity)
- R: reset
- 1-4: quality (Low / Medium / High / Ultra)
