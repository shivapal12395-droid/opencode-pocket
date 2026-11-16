# Security

Pocket is a static client. It does not run a server, collect analytics, or send data anywhere except the OpenCode server you point it at.

## Things to know

- **The password is powerful.** `opencode serve` exposes file access and shell execution on the host. Treat the password and pairing links like SSH keys.
- **Pairing links are one-time and expire in 5 minutes.** Prefer them over typing a password.
- **Passwords rotate** when the server restarts. Pocket will ask you to reconnect.
- **Local storage.** The server URL and token are kept in `localStorage` for that origin. Use “Forget” in Settings on a shared device.
- **LAN exposure.** Binding `opencode serve` to `0.0.0.0` lets anyone on that network try to connect. Only do it on trusted Wi-Fi, never on public networks, and never forward the port from your router.

## Reporting

Please do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting on this repository, or contact the maintainer listed on the repository profile.
