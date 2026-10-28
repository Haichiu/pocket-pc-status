/**
 * PC status: a page on the rail with this computer's CPU, memory, GPU, and how steady its internet link is. While a tab
 * has the page open, the server samples every 2 seconds with fixed system commands: `vm_stat`, `sysctl`, and `ioreg`
 * (macOS), `ping -c 1` to 1.1.1.1 (Cloudflare; one ICMP packet, no data of yours), and `sudo -n /usr/bin/powermetrics`
 * for GPU watts and frequency. The `sudo` call runs only when you added a sudoers line that allows exactly that command
 * without a password; with no such line it fails and the module reads the GPU load from `ioreg` instead. The module
 * reads no files, sends nothing else over the network, and keeps nothing on disk. It stops sampling 15 seconds after
 * the last tab asks, and the page is for the owner alone.
 */
import { execFile } from "node:child_process";
import { cpus, hostname, totalmem, uptime, userInfo } from "node:os";
import type { Web } from "./_pocket.d.ts";

export const pocketApi = 1;

const TICK_MS = 2000;
/** The sampler stops when no tab has asked for this long. */
const IDLE_MS = 15_000;
/** The ping history: 30 readings, 2 seconds apart, so one minute. */
const HISTORY = 30;
const PING_HOST = "1.1.1.1";

const run = (file: string, args: string[], timeout = 4000) =>
    new Promise<string>((resolve) => {
        execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout) =>
            resolve(error ? "" : String(stdout)),
        );
    });

interface Gpu {
    percent: number | null;
    watts: number | null;
    mhz: number | null;
    source: "powermetrics" | "ioreg" | "none";
}

/** GPU load. powermetrics (root, no password by an exact sudoers line) gives watts and frequency too. */
async function readGpu(): Promise<Gpu> {
    const power = await run("sudo", [
        "-n",
        "/usr/bin/powermetrics",
        "--samplers",
        "gpu_power",
        "-i",
        "1000",
        "-n",
        "1",
    ], 5000);
    const residency = /GPU HW active residency:\s*([\d.]+)%/.exec(power);

    if (residency) {
        const mw = /GPU Power:\s*([\d.]+)\s*mW/.exec(power);
        const mhz = /GPU HW active frequency:\s*([\d.]+)\s*MHz/.exec(power);

        return {
            percent: Number(residency[1]),
            watts: mw ? Number(mw[1]) / 1000 : null,
            mhz: mhz ? Number(mhz[1]) : null,
            source: "powermetrics",
        };
    }

    const io = await run("ioreg", ["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]);
    const util = /"Device Utilization %"\s*=\s*(\d+)/.exec(io);

    return util
        ? { percent: Number(util[1]), watts: null, mhz: null, source: "ioreg" }
        : { percent: null, watts: null, mhz: null, source: "none" };
}

/** Memory in use, as Activity Monitor counts it: app + wired + compressed. */
async function readMemory() {
    const total = totalmem();
    const out = await run("vm_stat", []);
    const page = Number(/page size of (\d+)/.exec(out)?.[1] ?? 16384);
    const get = (name: string) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(out)?.[1] ?? 0);
    const used = (get("Anonymous pages") + get("Pages wired down") + get("Pages occupied by compressor")) * page;
    const swap = /used = ([\d.]+)M/.exec(await run("sysctl", ["-n", "vm.swapusage"]));

    return { total, used: Math.min(total, used || 0), swapMb: swap ? Number(swap[1]) : 0 };
}

function cpuTimes() {
    let idle = 0;
    let all = 0;

    for (const { times } of cpus()) {
        idle += times.idle;
        all += times.user + times.nice + times.sys + times.idle + times.irq;
    }

    return { idle, all };
}

async function ping(): Promise<number | null> {
    const out = await run("ping", ["-c", "1", "-t", "2", PING_HOST], 3000);
    const ms = /time=([\d.]+) ms/.exec(out);

    return ms ? Number(ms[1]) : null;
}

export default function createPcStatus(_host: unknown, web: Web) {
    const model = cpus()[0]?.model ?? "CPU";
    const history: Array<number | null> = [];
    let snapshot: Record<string, unknown> | null = null;
    let previous = cpuTimes();
    let seen = 0;
    let timer: NodeJS.Timeout | undefined;
    let busy = false;
    let cpuPercent = 0;
    let waiting: Array<() => void> = [];

    async function tick() {
        if (busy) {
            return;
        }

        busy = true;

        try {
            const now = cpuTimes();
            const span = now.all - previous.all;

            cpuPercent = span > 0 ? Math.round((1 - (now.idle - previous.idle) / span) * 1000) / 10 : cpuPercent;
            previous = now;

            const [memory, gpu, rtt] = await Promise.all([readMemory(), readGpu(), ping()]);

            history.push(rtt);

            if (history.length > HISTORY) {
                history.shift();
            }

            const got = history.filter((each): each is number => each !== null);
            const avg = got.length ? got.reduce((a, b) => a + b, 0) / got.length : null;
            const jitter =
                avg === null ? null : Math.sqrt(got.reduce((a, b) => a + (b - avg) ** 2, 0) / got.length);

            snapshot = {
                at: Date.now(),
                host: hostname().replace(/\.local$/, ""),
                user: userInfo().username,
                chip: model,
                cores: cpus().length,
                uptime: Math.round(uptime()),
                cpu: cpuPercent,
                memory,
                gpu,
                net: {
                    target: PING_HOST,
                    history: [...history],
                    last: rtt,
                    avg,
                    jitter,
                    loss: history.length ? history.filter((each) => each === null).length / history.length : 0,
                },
            };
        } finally {
            busy = false;
            const release = waiting;

            waiting = [];
            release.forEach((each) => each());

            if (Date.now() - seen > IDLE_MS && timer) {
                clearInterval(timer);
                timer = undefined;
            }
        }
    }

    /** A tab asked: start sampling if it is not, and wait for the first reading. */
    async function status() {
        seen = Date.now();

        if (!timer) {
            previous = cpuTimes();
            timer = setInterval(() => void tick(), TICK_MS);
            timer.unref();
            // CPU needs two readings to compare, so the first call waits 1 second, then reads.
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await tick();
        } else if (!snapshot) {
            await new Promise<void>((resolve) => waiting.push(resolve));
        }

        return snapshot;
    }

    // GET /api/x/pc-status/status, for the owner alone (the default).
    web.route("GET", "status", () => status());
    web.client("pc-status");
    web.onDispose(() => clearInterval(timer));
}
