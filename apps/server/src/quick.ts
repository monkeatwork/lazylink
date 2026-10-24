// One-tap actions that skip the model entirely: instant, free and deterministic.
import { spawn, type ChildProcess } from "node:child_process";
import { basename } from "node:path";
import { osascript, screenshot, sh, systemInfo } from "@lazylink/mac-tools-mcp/mac";
import { MEDIA_DIR } from "./config.ts";

let caffeinate: ChildProcess | undefined;
export const keepAwakeOn = () => !!caffeinate && caffeinate.exitCode === null;

function setKeepAwake(on: boolean) {
  if (on && !keepAwakeOn()) {
    // -d display, -i idle, -s system (on AC power): the Mac stays reachable until turned off.
    caffeinate = spawn("caffeinate", ["-dis"], { stdio: "ignore" });
    caffeinate.on("exit", () => (caffeinate = undefined));
  } else if (!on) {
    caffeinate?.kill();
    caffeinate = undefined;
  }
  return keepAwakeOn();
}
process.on("exit", () => caffeinate?.kill());

async function changeVolume(direction: string) {
  if (direction === "mute") await osascript("set volume with output muted");
  else if (direction === "unmute") await osascript("set volume without output muted");
  else {
    const delta = direction === "down" ? -10 : 10;
    await osascript(
      `set v to output volume of (get volume settings)
       set volume output volume (v + ${delta}) without output muted`,
    );
  }
  return `Volume ${await osascript("output volume of (get volume settings)")}%`;
}

async function playPause() {
  for (const app of ["Spotify", "Music"]) {
    if ((await osascript(`application "${app}" is running`)) === "true") {
      await osascript(`tell application "${app}" to playpause`);
      const state = await osascript(`tell application "${app}" to player state as string`).catch(() => "");
      return `${app}: ${state || "toggled"}`;
    }
  }
  return "Neither Spotify nor Music is running.";
}

export type QuickResult = { text?: string; url?: string; keepAwake?: boolean };

export const QUICK_ACTIONS: Record<string, (arg?: string) => Promise<QuickResult>> = {
  screenshot: async () => {
    const { file } = await screenshot({ mediaDir: MEDIA_DIR });
    return { url: `/media/${basename(file)}` };
  },
  lock: async () => {
    await sh("pmset", ["displaysleepnow"]);
    return { text: "Display asleep. The Mac locks if a password is required after sleep." };
  },
  battery: async () => ({ text: await systemInfo() }),
  volume: async (arg = "up") => ({ text: await changeVolume(arg) }),
  playpause: async () => ({ text: await playPause() }),
  "keep-awake": async (arg) => {
    const on = setKeepAwake(arg === "on");
    return { keepAwake: on, text: on ? "Keeping the Mac awake." : "Normal sleep restored." };
  },
};
