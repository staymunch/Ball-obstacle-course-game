# Ball Roll Adventure

An easy, kid-friendly browser game: roll a tennis ball down a wooden track, dodge obstacles, collect stars and reach the finish line.

- **Steer** by sliding a finger left/right; **swipe up** to speed up and **down** to brake (arrow keys on a computer).
- **Guard rails** line most of the track. From level 2 there are rail-less stretches (red/white curbs) where the ball can roll off. There's always a checkpoint just before them.
- **Obstacles:** sliding blocks, spinners, swinging hammers, ramps that launch the ball through rings, and speed boost pads. The track twists and turns between them.
- **Star ratings:** collect stars for a 1–3 star rating on each level. The best rating is saved.
- **Worlds:** the theme changes every two levels (Sky, Candy, Ice, Sunset, Space).
- **Endless levels**, each a little harder than the last. Progress is saved on the device.

No build step and no internet needed after loading. It's plain HTML/JS with Three.js bundled in `vendor/`.

## Put it on the iPad

1. On GitHub, open **Settings → Pages**, set *Source* to **Deploy from a branch**, choose `main` / `(root)`, and save.
2. After a minute the game is live at `https://staymunch.github.io/Ball-obstacle-course-game/`.
3. Open that link in **Safari** on the iPad, tap **Share → Add to Home Screen**.

When launched from the home screen it runs full screen with its own icon.

## Run locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```
