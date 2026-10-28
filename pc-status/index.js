// PC status's browser module: a rail button, a launcher action, a status-line item, and a page set like the Subscription
// usage page: a "mac@pi-pocket" card, then CPU, memory, and GPU as rows of small squares, and the internet link's last
// minute as a strip of bars. The server (pc-status.ts) reads the machine; this only shows it.

export const pocketApi = 1;

/** A monitor with a pulse line, as a 24×24 stroked path like the app's own icons. */
const MONITOR = "M3 5h18v11H3zM8 20h8M12 16v4M6 11h3l1.5-3 3 5 1.5-2H18";
const ALERT = "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7.5v5.5M12 16.5v.01";
const PAGE_EVERY_MS = 2000;
const STATUS_EVERY_MS = 5000;
const CELLS = 20;
const WARN = 70;
const CRIT = 90;
/** The bar strip tops out here: a ping at or over this many ms fills a bar. */
const PING_CEIL = 200;
const GLYPH = [
    "▗▄▄▄▄▄▄▄▄▄▄▖",
    "▐ ▁▃▅▇▅▃▁  ▌",
    "▝▀▀▀▜██▛▀▀▀▘",
    "    ▄██▄    ",
].join("\n");

const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)}`;
const level = (percent) => (percent >= CRIT ? "critical" : percent >= WARN ? "warning" : "ok");
const lit = (percent) => Math.min(CELLS, Math.max(0, Math.round((percent / 100) * CELLS)));
const LEVEL_WORDS = { warning: "Busy", critical: "Maxed" };

function since(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** How steady the link is, from the last minute of pings. */
function link(net) {
    const got = net.history.filter((each) => each !== null);

    if (net.history.length > 2 && got.length === 0) {
        return { level: "critical", word: "Offline" };
    }

    if (net.loss >= 0.1 || (net.avg ?? 0) > 150 || (net.jitter ?? 0) > 50) {
        return { level: "critical", word: "Unstable" };
    }

    if (net.loss > 0 || (net.avg ?? 0) > 80 || (net.jitter ?? 0) > 20) {
        return { level: "warning", word: "Fair" };
    }

    return { level: "ok", word: "Stable" };
}

export default function setup(pocket) {
    const { html, useEffect, useState, Icon, Loader, Switch } = pocket;

    pocket.style("look.css");

    /** One resource: its name, a gauge of squares, the percent, and a line of details under it. */
    function Gauge({ label, percent, children, unknown }) {
        const tone = unknown ? "ok" : level(percent);
        const on = unknown ? 0 : lit(percent);
        const word = LEVEL_WORDS[tone];

        return html`<li class=${`pc-limit pc-${tone}`}>
            <span class="pc-label">${label}</span>
            <span class="pc-gauge" aria-hidden="true">
                ${Array.from(
                    { length: CELLS },
                    (_, at) => html`<span class=${at < on ? "pc-cell pc-on" : "pc-cell"}></span>`,
                )}
            </span>
            <span class="pc-value"
                >${unknown ? "–" : Math.round(percent)}<span class="pc-unit">%</span></span
            >
            <span class="pc-meta">
                ${word ? html`<span class=${`pc-flag pc-${tone}`}>${word}</span><span class="pc-sep">·</span>` : null}
                ${children}
            </span>
        </li>`;
    }

    function Section({ title, count, index, children }) {
        return html`<section class="pc-plan" style=${`--i:${index}`}>
            <div class="pc-plan-head">
                <h3>${title}</h3>
                <span class="pc-rule"></span>
                ${count ? html`<span class="pc-count">${count}</span>` : null}
            </div>
            ${children}
        </section>`;
    }

    function Strip({ net }) {
        return html`<div class="pc-strip" aria-hidden="true">
            ${Array.from({ length: 30 }, (_, at) => {
                const value = net.history[at - (30 - net.history.length)];
                const missing = at < 30 - net.history.length;
                const lost = !missing && value === null;
                const height = missing ? 0 : lost ? 100 : Math.max(8, Math.min(100, (value / PING_CEIL) * 100));
                const tone = lost ? "critical" : value > 150 ? "critical" : value > 80 ? "warning" : "ok";

                return html`<span
                    class=${`pc-bar pc-${tone}${lost ? " pc-lost" : ""}${missing ? " pc-none" : ""}`}
                    style=${`--h:${height}%`}
                ></span>`;
            })}
        </div>`;
    }

    function PcStatus() {
        const [data, setData] = useState(null);
        const [error, setError] = useState(null);
        const [rtt, setRtt] = useState(null);
        const [footnote, setFootnoteState] = useState(wanted.on);

        useEffect(() => {
            listeners.add(setFootnoteState);

            return () => listeners.delete(setFootnoteState);
        }, []);

        useEffect(() => {
            const stop = new AbortController();
            let alive = true;

            const load = async () => {
                const started = performance.now();

                try {
                    const next = await pocket.api("status", undefined, { signal: stop.signal });

                    if (alive) {
                        setRtt(Math.round(performance.now() - started));
                        setData(next);
                        setError(null);
                        push(next);
                    }
                } catch (failure) {
                    if (alive && !stop.signal.aborted) {
                        setError(failure.message);
                    }
                }
            };

            void load();
            const timer = setInterval(() => void load(), PAGE_EVERY_MS);

            return () => {
                alive = false;
                stop.abort();
                clearInterval(timer);
            };
        }, []);

        if (!data && error) {
            return html`<div class="pc">
                <div class="pc-state" role="alert">
                    <${Icon} path=${ALERT} size=${16} />
                    <div>
                        <p class="pc-state-title">Could not read this computer</p>
                        <p class="pc-state-detail">${error}</p>
                    </div>
                </div>
            </div>`;
        }

        if (!data) {
            return html`<div class="pc" aria-busy="true"><${Loader} label="Reading this computer" /></div>`;
        }

        const memPercent = (data.memory.used / data.memory.total) * 100;
        const net = data.net;
        const state = link(net);
        const stamp = new Date(data.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
        const gpu = data.gpu;

        return html`<div class="pc">
            <div class="pc-fetch">
                <pre class="pc-glyph" aria-hidden="true">${GLYPH}</pre>
                <div class="pc-info">
                    <div class="pc-title">
                        <span class="pc-host"><b>${data.user}</b>@${data.host}</span>
                        <span class="pc-live"><i></i>live</span>
                    </div>
                    <dl class="pc-rows">
                        <div class="pc-row" style="--i:1"><dt>chip</dt><dd>${data.chip} · ${data.cores} cores</dd></div>
                        <div class="pc-row" style="--i:2"><dt>up</dt><dd><b>${since(data.uptime)}</b></dd></div>
                        <div class="pc-row" style="--i:3">
                            <dt>link</dt>
                            <dd>
                                <span class=${`pc-flag pc-${state.level}`}>${state.word}</span>
                                ${rtt !== null ? html`<span class="pc-sep"> · </span>${rtt} ms to here` : null}
                            </dd>
                        </div>
                        <div class="pc-row" style="--i:4"><dt>read</dt><dd>${stamp}</dd></div>
                    </dl>
                </div>
            </div>

            <label class="pc-toggle">
                <${Switch} on=${footnote} label="Show CPU in the status line" onChange=${() => setFootnote(!wanted.on)} />
                <span>Show in status line <span class="pc-quiet">· hidden on narrow screens</span></span>
            </label>

            <${Section} title="Compute" count="live" index=${2}>
                <ul class="pc-limits">
                    <${Gauge} label="CPU" percent=${data.cpu}>
                        <span>${data.cores} cores</span>
                    <//>
                    <${Gauge} label="Memory" percent=${memPercent}>
                        <span><strong>${gib(data.memory.used)}</strong> of ${gib(data.memory.total)} GiB</span>
                        ${data.memory.swapMb > 0 ? html`<span class="pc-sep">·</span><span>swap ${Math.round(data.memory.swapMb)} MB</span>` : null}
                    <//>
                    <${Gauge} label="GPU" percent=${gpu.percent ?? 0} unknown=${gpu.percent === null}>
                        ${
                            gpu.percent === null
                                ? html`<span>Not readable</span>`
                                : html`<span>${gpu.mhz ? `${Math.round(gpu.mhz)} MHz` : "load"}</span>${gpu.watts !== null ? html`<span class="pc-sep">·</span><span><strong>${gpu.watts.toFixed(1)}</strong> W</span>` : null}${gpu.source === "ioreg" ? html`<span class="pc-sep">·</span><span>approx.</span>` : null}`
                        }
                    <//>
                </ul>
            <//>

            <${Section} title="Network" count=${`ping ${net.target}`} index=${3}>
                <div class=${`pc-net pc-${state.level}`}>
                    <div class="pc-net-top">
                        <span class="pc-balance-amount">${net.last === null ? "–" : Math.round(net.last)}<span class="pc-unit"> ms</span></span>
                        <span class=${`pc-flag pc-${state.level}`}>${state.word}</span>
                    </div>
                    <${Strip} net=${net} />
                    <div class="pc-meta">
                        <span>avg <strong>${net.avg === null ? "–" : Math.round(net.avg)}</strong> ms</span><span class="pc-sep">·</span>
                        <span>jitter <strong>${net.jitter === null ? "–" : net.jitter.toFixed(1)}</strong> ms</span><span class="pc-sep">·</span>
                        <span>loss <strong>${Math.round(net.loss * 100)}</strong>%</span><span class="pc-sep">·</span>
                        <span>last minute</span>
                    </div>
                </div>
            <//>
        </div>`;
    }

    pocket.page({ id: "pc", title: "PC status", component: PcStatus });
    const rail = pocket.rail({ id: "pc", title: "PC status", iconPath: MONITOR, page: "pc" });

    pocket.launcher({
        id: "pc",
        label: "PC status",
        detail: "CPU, memory, GPU, and network",
        iconPath: MONITOR,
        keywords: ["cpu", "ram", "memory", "gpu", "ping", "network", "latency", "computer", "mac", "monitor"],
        page: "pc",
    });

    /** The status line item. It is a setting (kept in this browser), and it steps aside on a narrow screen, so the plan
     * quota and the balance keep the room. The page and the rail badge read the same machine, so only the item's own
     * polling stops when it is off or hidden. */
    const KEY = "x.pc-status.footnote";
    const narrow = window.matchMedia("(max-width: 640px)");
    const wanted = { on: localStorage.getItem(KEY) !== "off" };
    let item = null;
    let timer = null;
    let stop = null;
    const listeners = new Set();

    function push(next) {
        const mem = Math.round((next.memory.used / next.memory.total) * 100);
        const busiest = Math.max(next.cpu, mem, next.gpu.percent ?? 0);
        const state = link(next.net);
        const tone = busiest >= CRIT || state.level === "critical" ? "warn" : undefined;

        rail.update({ badge: busiest >= CRIT ? Math.round(busiest) : null });
        item?.update({
            text: `CPU ${Math.round(next.cpu)}% · RAM ${mem}%`,
            short: `CPU ${Math.round(next.cpu)}%`,
            title: `GPU ${next.gpu.percent === null ? "n/a" : `${Math.round(next.gpu.percent)}%`} · net ${state.word}${next.net.last === null ? "" : ` ${Math.round(next.net.last)} ms`}`,
            tone,
        });
    }

    function sync() {
        const show = wanted.on && !narrow.matches && typeof pocket.status === "function";

        if (show && !item) {
            item = pocket.status({ id: "pc", label: "PC status", text: "CPU …", page: "pc" });
            stop = new AbortController();
            const poll = () => pocket.api("status", undefined, { signal: stop.signal }).then(push, () => item?.update({ tone: "muted" }));

            void poll();
            timer = setInterval(poll, STATUS_EVERY_MS);
        } else if (!show && item) {
            stop.abort();
            clearInterval(timer);
            item.remove();
            item = null;
        }
    }

    function setFootnote(on) {
        wanted.on = on;
        localStorage.setItem(KEY, on ? "on" : "off");
        sync();
        listeners.forEach((each) => each(on));
    }

    pocket.launcher({
        id: "pc-footnote",
        label: "PC status: show or hide in the status line",
        iconPath: MONITOR,
        run: () => setFootnote(!wanted.on),
    });

    narrow.addEventListener("change", sync);
    sync();

    return () => {
        narrow.removeEventListener("change", sync);
        stop?.abort();
        clearInterval(timer);
    };
}
