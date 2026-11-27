import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Stage } from "../kit/stage";
import type { Act } from "../kit/act";
import { Roll } from "../kit/motion/Roll";
import { States } from "../kit/motion/States";
import { proof, proofTitle, request, result, steps } from "../lib/hero-demo.ts";

// The animated hero demo: a Stageshow stage laid exactly over the static
// frame in HeroDemo.astro, drawing the same lines with the same classes at
// the same size. The static frame stays in the page and keeps the layout, so
// hydrating moves nothing; under reduced motion this renders nothing and the
// static frame is all there is.
//
// `shown` counts the lines on screen after the request, in reading order:
// the heading (1), the three proof lines (2 to 4), the five checks (5 to 9)
// and the result (10). `done` counts finished checks; 6 means the result has
// landed. The phone frame shows only the heading, the proof and one status
// line (5), which rolls through each check's result to the result itself.
type S = { shown: number; done: number };

// The loop opens and ends on the finished frame, the same as the static one.
const FINISHED: S = { shown: 10, done: 6 };
const PHONE = "(max-width: 600px)";
const REDUCED = "(prefers-reduced-motion: reduce)";
const PAUSED_KEY = "hero-demo-paused";

// Hold the finished frame, then the session's output leaves in one reverse
// stagger around an anchor that stays (the request; on a phone, which has
// no request line, the heading), and the session runs again.
async function clear(a: Act<S>, from: number, keep: number) {
  await a.wait(2600);
  a.mark("clear");
  for (let n = from - 1; n >= keep; n--) {
    a.put({ shown: n });
    await a.wait(50);
  }
  // The checks reset while their lines are hidden, never in view.
  await a.wait(240);
  await a.snap({ done: 0 });
  await a.wait(80);
}

async function prove(a: Act<S>) {
  a.mark("prove");
  a.put({ shown: 1 });
  await a.wait(320);
  for (const n of [2, 3, 4]) {
    a.put({ shown: n });
    await a.wait(160);
  }
  await a.wait(1200);
}

const wideScript = async (a: Act<S>) => {
  await clear(a, 10, 0);
  await prove(a);
  a.mark("checks");
  for (let i = 0; i < steps.length; i++) {
    a.put({ shown: 5 + i });
    await a.wait(820);
    a.put({ done: i + 1 });
    await a.wait(380);
  }
  await a.wait(240);
  a.mark("ready");
  await a.set({ shown: 10, done: 6 });
};

const phoneScript = async (a: Act<S>) => {
  await clear(a, 5, 1);
  await prove(a);
  a.mark("checks");
  a.put({ shown: 5, done: 1 });
  for (let d = 2; d <= 5; d++) {
    await a.wait(1150);
    a.put({ done: d });
  }
  await a.wait(1150);
  a.mark("ready");
  await a.set({ shown: 10, done: 6 });
};

const mark = { pending: <span className="d-wait">·</span>, ok: <span className="d-ok">✓</span> };

function Wide({ s }: { s: S }) {
  return (
    <div className="demo-body">
      <div className="d-in">
        <span className="d-p">&gt;</span> {request}
      </div>
      <div className="d-h" data-item data-in={s.shown >= 1 || undefined}>{proofTitle}</div>
      <div className="d-proof">
        {proof.map((line, i) => (
          <div key={line} data-item data-in={s.shown >= 2 + i || undefined}>{line}</div>
        ))}
      </div>
      <div className="d-steps">
        {steps.map(({ label, pending, detail }, i) => {
          const done = s.done > i;
          return (
            <div key={label} data-item data-in={s.shown >= 5 + i || undefined}>
              <States className="d-mark" align="start" value={done ? "ok" : "pending"} states={mark} />
              <span className="d-l">{label}</span>
              <span className="d-x">
                <Roll>{done ? detail : pending}</Roll>
              </span>
            </div>
          );
        })}
      </div>
      <div className="d-end" data-item data-in={s.shown >= 10 || undefined}>
        <span className="dot" />
        {result}
      </div>
    </div>
  );
}

function Phone({ s }: { s: S }) {
  const ready = s.done >= 6;
  const step = steps[Math.max(0, Math.min(s.done, steps.length) - 1)];
  return (
    <div className="demo-body">
      <div className="d-h" data-item data-in={s.shown >= 1 || undefined}>{proofTitle}</div>
      <div className="d-proof">
        {proof.map((line, i) => (
          <div key={line} data-item data-in={s.shown >= 2 + i || undefined}>{line}</div>
        ))}
      </div>
      <div className="d-end" data-item data-in={s.shown >= 5 || undefined}>
        <States
          className="d-mark d-end-mark"
          value={ready ? "ready" : "ok"}
          states={{ ok: <span className="d-ok">✓</span>, ready: <span className="dot" /> }}
        />
        <Roll>{ready ? result : `${step.label} ${step.detail}`}</Roll>
      </div>
    </div>
  );
}

const readPaused = () => {
  try {
    return sessionStorage.getItem(PAUSED_KEY) === "1";
  } catch {
    return false;
  }
};

const useMedia = (query: string) => {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
};

type Box = { top: number; left: number; width: number; height: number; bar: number };

export default function HeroDemoLive() {
  const anchor = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const phone = useMedia(PHONE);
  const reduced = useMedia(REDUCED);

  useEffect(() => {
    setPaused(readPaused());
    setReady(true);
  }, []);

  // Follow the static body's box: the stage is drawn at its exact size.
  useEffect(() => {
    const figure = anchor.current?.closest<HTMLElement>("[data-hero-demo]");
    const body = figure?.querySelector<HTMLElement>(":scope > .demo-body");
    const bar = figure?.querySelector<HTMLElement>(":scope > .demo-bar");
    if (!figure || !body || !bar) return;
    // Fractional pixels, so the two frames line up exactly; the figure's
    // border is outside the box its absolute children are placed in.
    const measure = () => {
      const f = figure.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      const top = b.top - f.top - figure.clientTop;
      const left = b.left - f.left - figure.clientLeft;
      setBox({ top, left, width: b.width, height: b.height, bar: bar.getBoundingClientRect().height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  const live = ready && !reduced && box !== null && box.width > 0;

  // Hide the static body only once the stage has painted over it.
  useLayoutEffect(() => {
    const figure = anchor.current?.closest<HTMLElement>("[data-hero-demo]");
    figure?.toggleAttribute("data-live", live);
    return () => figure?.removeAttribute("data-live");
  }, [live]);

  const toggle = () => {
    const next = !paused;
    setPaused(next);
    try {
      sessionStorage.setItem(PAUSED_KEY, next ? "1" : "0");
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  };

  return (
    <span ref={anchor} className="demo-live">
      {live && (
        <>
          <span className="demo-stage" aria-hidden="true" style={{ top: box.top, left: box.left, width: box.width, height: box.height }}>
            <Stage<S>
              key={phone ? "phone" : "wide"}
              width={box.width}
              height={box.height}
              initial={FINISHED}
              poster={FINISHED}
              script={paused ? undefined : phone ? phoneScript : wideScript}
            >
              {(s) => (phone ? <Phone s={s} /> : <Wide s={s} />)}
            </Stage>
          </span>
          <button type="button" className="demo-toggle" style={{ height: box.bar }} aria-label={paused ? "Play demo" : "Pause demo"} onClick={toggle}>
            <span aria-hidden="true">{paused ? "Play" : "Pause"}</span>
          </button>
        </>
      )}
    </span>
  );
}
