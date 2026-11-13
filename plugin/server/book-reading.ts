import { spawn } from "node:child_process";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { bookReadingRpc } from "../shared/book-reading";

const SCRIPT = "/srv/paseo-sidebar/plugin/server/book_reader.py";
export function registerBookReading(server: PluginServerContext) {
  server.handle(bookReadingRpc, input => new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/python3", [SCRIPT], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("读取书籍超时，请重试")); }, 20_000);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-2000); });
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", code => {
      clearTimeout(timeout);
      try {
        const value = JSON.parse(stdout);
        if (code !== 0 || value.error) throw new Error(value.error || "读取书籍失败");
        resolve(bookReadingRpc.output.parse(value));
      } catch (error) {
        reject(error instanceof SyntaxError ? new Error(stderr || "无法读取书籍") : error);
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(input));
  }));
}
