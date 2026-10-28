# pocket-pc-status

A [Pi Pocket](https://github.com/TannerMidd/pi-pocket) extension: a rail page with this computer's CPU, memory, GPU, and internet link quality (ping to 1.1.1.1, history, jitter, loss). macOS.

Files: `pc-status.ts` (server module), `pc-status/index.js` and `pc-status/look.css` (browser module).

What it runs, only while a tab has the page open: `vm_stat`, `sysctl -n vm.swapusage`, `ioreg`, `ping -c 1 -t 2 1.1.1.1`, and `sudo -n /usr/bin/powermetrics` (optional, needs a passwordless sudoers line for exactly that command). It reads no files and has no other network use.

MIT license.
