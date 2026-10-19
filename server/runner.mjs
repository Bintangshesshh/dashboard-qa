import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export class Runner extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.running = false;
    this.log = [];
  }

  start(mode = "pw", specs = []) {
    if (this.running) return { ok: false, error: "sudah jalan" };

    this.running = true;
    this.log = [];
    this.emit("start", { mode, specs });

    // Panggil node langsung, bukan `npm run`: banner npm ("dashboard-qa@1.0.0 cek:pw")
    // cuma nyampah di log dashboard.
    const args = ["scripts/cek.mjs", mode, ...specs];

    // Playwright set FORCE_COLOR; kalau NO_COLOR masih ada Node nyembur warning
    // "'NO_COLOR' env is ignored" di tengah log.
    const env = {...process.env};
    delete env.NO_COLOR;

    this.proc = spawn(process.execPath, args, {
      cwd: process.cwd().replace(/[\/\\]server$/, ""),
      env,
    });

    this.proc.stdout.on("data", (d) => {
      const line = d.toString();
      this.log.push(line);
      this.emit("log", line);
    });

    this.proc.stderr.on("data", (d) => {
      const line = d.toString();
      this.log.push(line);
      this.emit("log", line);
    });

    this.proc.on("close", (code) => {
      this.running = false;
      this.emit("done", { code, log: this.log });
      this.proc = null;
    });

    return { ok: true };
  }

  stop() {
    if (!this.proc) return { ok: false };
    this.proc.kill();
    return { ok: true };
  }

  status() {
    return { running: this.running, log: this.log };
  }
}
