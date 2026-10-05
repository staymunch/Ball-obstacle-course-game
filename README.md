# Ball Roll Adventure

An easy, kid-friendly browser game: roll a tennis ball down a wooden track, dodge obstacles, collect stars and reach the finish line.

- **Steer** by sliding a finger left/right anywhere on the screen (arrow keys on a computer).
- **Guard rails** line the whole track. The only open spots are the jump gaps.
- **Obstacles:** sliding blocks, spinners, swinging hammers, plus ramps that launch the ball through rings. Obstacles only bump the ball, they never end the game.
- **Checkpoints:** if the ball misses a jump, it reappears at the last checkpoint.
- **Endless levels:** each level is a little longer and busier than the last. New obstacle types unlock at levels 2 (spinners) and 3 (hammers and jump gaps). Progress is saved on the device.

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
