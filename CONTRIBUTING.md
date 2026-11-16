# Contributing

Thanks for wanting to improve Pocket. Two rules keep this project pleasant:

1. **No dependencies.** Vanilla HTML/CSS/JS only. No bundler, no framework, no `node_modules`.
2. **Mobile first.** Every change should feel right at 390×844 with one thumb, then scale up.

## Local setup

```bash
git clone https://github.com/shivapal12395-droid/opencode-pocket.git
cd opencode-pocket
node server.mjs --port 8099
```

Run OpenCode in another terminal:

```bash
opencode serve --port 4096
```

Open <http://127.0.0.1:8099> and paste the server password.

## Before opening a PR

- Test on a phone or Chrome DevTools mobile emulation (Pixel 7).
- Check dark **and** light theme.
- Check `prefers-reduced-motion`.
- Keep the diff focused; one feature or fix per PR.
- If you touch the API layer, mention the OpenCode version you tested (`opencode --version`).

## Ideas that would help most

- Session list pagination / pull-to-refresh
- `@` file mentions using `/api/fs/find`
- Voice input via the Web Speech API
- Better error states when the server is unreachable
- Screenshots and short clips for the README

Open an issue first for anything bigger than a small fix.
