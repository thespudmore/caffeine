const SVG = "http://www.w3.org/2000/svg";

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

const Y_MAX = 300;

function yTicks(yMax) {
  const raw = Math.max(yMax / 4, 1e-6);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const candidates = [1, 2, 2.5, 5, 10].map((step) => step * pow);
  let step = candidates[candidates.length - 1];
  for (const candidate of candidates) {
    if (yMax / candidate <= 6) {
      step = candidate;
      break;
    }
  }
  const ticks = [];
  for (let value = 0; value <= yMax + step * 0.01; value += step) {
    if (value <= yMax + 1e-6) ticks.push(Math.round(value * 1000) / 1000);
  }
  return ticks;
}

function hourStep(span) {
  if (span <= 8 * 60) return 60;
  if (span <= 16 * 60) return 120;
  return 180;
}

function formatTick(minute) {
  const rounded = Math.round(minute);
  if (rounded >= 1440) return "24:00";
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (m === 0) return String(h);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatClock(minute) {
  const rounded = Math.round(minute);
  if (rounded >= 1440) return "24:00";
  const h = Math.floor(Math.max(0, rounded) / 60);
  const m = Math.max(0, rounded) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatAxisMg(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function areaPaths(points) {
  const paths = [];
  let run = [];
  let runSign = 0;
  const flush = () => {
    if (run.length >= 2 && runSign !== 0) paths.push({ sign: runSign, points: run });
    run = [];
  };
  const absorb = (sign, a, b) => {
    if (runSign !== sign) {
      flush();
      runSign = sign;
      run = [a];
    } else if (run.length === 0) run.push(a);
    run.push(b);
  };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.D) < 0.05 && Math.abs(b.D) < 0.05) {
      flush();
      runSign = 0;
      continue;
    }
    if ((a.D >= 0 && b.D >= 0) || (a.D <= 0 && b.D <= 0)) {
      absorb(a.D + b.D >= 0 ? 1 : -1, a, b);
      continue;
    }
    const u = a.D / (a.D - b.D);
    const mid = {
      minute: a.minute + (b.minute - a.minute) * u,
      L: a.L + (b.L - a.L) * u,
      B: a.B + (b.B - a.B) * u,
    };
    absorb(a.D > 0 ? 1 : -1, a, mid);
    flush();
    runSign = b.D > 0 ? 1 : -1;
    run = [mid, b];
  }
  flush();
  return paths;
}

function linePath(points, x, y, key) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.minute).toFixed(2)},${y(point[key]).toFixed(2)}`).join("");
}

export function drawChart(host, spec, onHover) {
  const width = Math.max(280, Math.round(host.clientWidth || 640));
  const height = width < 680 ? 300 : 420;
  const pad = { top: 46, right: 14, bottom: 32, left: 48 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const start = spec.start;
  const end = spec.end;
  const yMax = Y_MAX;
  const x = (minute) => pad.left + ((minute - start) / (end - start)) * plotW;
  const y = (value) => pad.top + (1 - value / yMax) * plotH;
  const plotBottom = pad.top + plotH;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": spec.label,
  });
  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.height = "auto";

  const defs = svgEl("defs");
  const above = svgEl("pattern", { id: "shade-above", width: "8", height: "8", patternUnits: "userSpaceOnUse" });
  above.append(
    svgEl("rect", { width: "8", height: "8", fill: "#0f6e62", "fill-opacity": "0.13" }),
    svgEl("path", { d: "M-2 8 L8 -2 M-2 2 L2 -2 M6 10 L10 6", stroke: "#0f6e62", "stroke-width": "1.1", fill: "none" }),
  );
  const below = svgEl("pattern", { id: "shade-below", width: "8", height: "8", patternUnits: "userSpaceOnUse" });
  below.append(
    svgEl("rect", { width: "8", height: "8", fill: "#a33b32", "fill-opacity": "0.12" }),
    svgEl("circle", { cx: "2", cy: "2", r: "1.05", fill: "#a33b32" }),
    svgEl("circle", { cx: "6", cy: "6", r: "1.05", fill: "#a33b32" }),
  );
  const clip = svgEl("clipPath", { id: "plot-clip" });
  clip.append(svgEl("rect", { x: pad.left, y: pad.top, width: plotW, height: plotH }));
  defs.append(above, below, clip);
  svg.append(defs);

  for (const tick of yTicks(yMax)) {
    const yy = y(tick);
    svg.append(svgEl("line", {
      x1: pad.left, x2: width - pad.right, y1: yy, y2: yy,
      stroke: "var(--line)", "stroke-width": tick === 0 ? "1.5" : "1",
    }));
    const label = svgEl("text", {
      x: pad.left - 8, y: yy + 4, "text-anchor": "end", fill: "var(--muted)", "font-size": "11",
    });
    label.textContent = formatAxisMg(tick);
    svg.append(label);
  }

  const step = hourStep(end - start);
  for (let minute = Math.ceil(start / step) * step; minute <= end + 1e-6; minute += step) {
    const xx = x(minute);
    svg.append(svgEl("line", {
      x1: xx, x2: xx, y1: pad.top, y2: plotBottom, stroke: "var(--line)", "stroke-width": "1",
    }));
    const label = svgEl("text", {
      x: xx, y: height - 10, "text-anchor": "middle", fill: "var(--muted)", "font-size": "11",
    });
    label.textContent = formatTick(minute);
    svg.append(label);
  }

  const plot = svgEl("g", { "clip-path": "url(#plot-clip)" });
  for (const area of areaPaths(spec.points)) {
    const forward = area.points.map((point) => `${x(point.minute).toFixed(2)},${y(point.L).toFixed(2)}`);
    const back = [...area.points].reverse().map((point) => `${x(point.minute).toFixed(2)},${y(point.B).toFixed(2)}`);
    plot.append(svgEl("path", {
      d: `M${forward.join("L")}L${back.join("L")}Z`,
      fill: area.sign > 0 ? "url(#shade-above)" : "url(#shade-below)",
    }));
  }
  if (spec.showHistory) {
    const peakWeight = Math.max(...spec.history.map((series) => series.weight), 0.001);
    for (const series of spec.history) {
      if (!series.points.some((point) => point.L > 0.4)) continue;
      plot.append(svgEl("path", {
        d: linePath(series.points, x, y, "L"),
        fill: "none",
        stroke: "var(--l)",
        "stroke-width": "1.25",
        "stroke-opacity": String(0.12 + 0.28 * (series.weight / peakWeight)),
      }));
    }
  }
  plot.append(svgEl("path", {
    d: linePath(spec.points, x, y, "B"),
    fill: "none",
    stroke: "var(--b)",
    "stroke-width": "2",
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  }));
  plot.append(svgEl("path", {
    d: linePath(spec.points, x, y, "L"),
    fill: "none",
    stroke: "var(--l)",
    "stroke-width": "2.4",
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  }));

  if (spec.nowMinute != null && spec.nowMinute >= start && spec.nowMinute <= end) {
    const nowX = x(spec.nowMinute);
    plot.append(svgEl("line", {
      x1: nowX, x2: nowX, y1: pad.top, y2: plotBottom,
      stroke: "var(--ink)", "stroke-width": "1", "stroke-dasharray": "2 4", "stroke-opacity": "0.45",
    }));
  }

  const captions = [];
  const placed = [];
  const compact = plotW < 560;
  const labelGap = compact ? 26 : 72;
  for (const marker of [...spec.markers].sort((a, b) => a.minute - b.minute)) {
    if (marker.minute < start || marker.minute > end) continue;
    const xx = x(marker.minute);
    let tier = 0;
    while (placed.some((item) => item.tier === tier && Math.abs(item.x - xx) < labelGap)) tier += 1;
    placed.push({ ...marker, x: xx, tier: Math.min(tier, 2) });
  }
  for (const marker of placed) {
    const onCurve = marker.L > yMax * 0.08;
    const yy = onCurve ? y(Math.min(yMax, marker.L)) : plotBottom - 14;
    plot.append(svgEl("line", {
      x1: marker.x,
      x2: marker.x,
      y1: onCurve ? yy : plotBottom - 14,
      y2: plotBottom,
      stroke: "var(--l)",
      "stroke-width": "1.25",
      "stroke-dasharray": marker.status === "planned" ? "2 3" : "0",
      "stroke-opacity": "0.55",
    }));
    const dot = svgEl("circle", {
      cx: marker.x,
      cy: yy,
      r: "5",
      fill: marker.status === "planned" ? "var(--card)" : "var(--l)",
      stroke: "var(--l)",
      "stroke-width": "2",
    });
    const title = svgEl("title");
    const name = marker.label ? `${marker.label}, ` : "";
    title.textContent = `${formatClock(marker.minute)} · ${name}${marker.amount} mg · ${marker.status}`;
    const group = svgEl("g");
    group.append(title, dot);
    plot.append(group);
    const caption = svgEl("text", {
      x: marker.x,
      y: pad.top + 12 + marker.tier * 13,
      "text-anchor": "middle",
      fill: "var(--ink)",
      "font-size": "11",
    });
    const namePart = !compact && marker.label ? marker.label.split(",")[0] : "";
    const text = namePart ? `${Math.round(marker.amount)} ${namePart}` : `${Math.round(marker.amount)}`;
    caption.textContent = text.length > 22 ? `${text.slice(0, 20)}…` : text;
    captions.push(caption);
  }

  const guide = svgEl("line", {
    y1: pad.top, y2: plotBottom, stroke: "var(--ink)", "stroke-width": "1", "stroke-opacity": "0.55", visibility: "hidden",
  });
  const dotL = svgEl("circle", { r: "4.5", fill: "var(--l)", stroke: "var(--card)", "stroke-width": "1.5", visibility: "hidden" });
  const dotB = svgEl("circle", { r: "4.5", fill: "var(--b)", stroke: "var(--card)", "stroke-width": "1.5", visibility: "hidden" });
  plot.append(guide, dotL, dotB);
  svg.append(plot);
  const zero = svgEl("text", {
    x: width - pad.right - 4, y: y(0) - 6, "text-anchor": "end", fill: "var(--zero)", "font-size": "11",
  });
  zero.textContent = "Fully reset";
  svg.append(zero, ...captions);

  const overlay = svgEl("rect", {
    x: pad.left, y: pad.top, width: plotW, height: plotH, fill: "#ffffff", "fill-opacity": "0",
  });
  overlay.style.cursor = "crosshair";
  const move = (event) => {
    if (!spec.points.length) return;
    const rect = svg.getBoundingClientRect();
    const scale = width / rect.width;
    const px = (event.clientX - rect.left) * scale;
    const minute = start + ((px - pad.left) / plotW) * (end - start);
    let nearest = spec.points[0];
    let best = Infinity;
    for (const point of spec.points) {
      const dist = Math.abs(point.minute - minute);
      if (dist < best) {
        nearest = point;
        best = dist;
      }
    }
    const xx = x(nearest.minute);
    guide.setAttribute("x1", xx);
    guide.setAttribute("x2", xx);
    guide.setAttribute("visibility", "visible");
    dotL.setAttribute("cx", xx);
    dotL.setAttribute("cy", y(nearest.L));
    dotL.setAttribute("visibility", "visible");
    dotB.setAttribute("cx", xx);
    dotB.setAttribute("cy", y(nearest.B));
    dotB.setAttribute("visibility", "visible");
    onHover(nearest);
  };
  overlay.addEventListener("pointerdown", move);
  overlay.addEventListener("pointermove", move);
  overlay.addEventListener("pointerleave", () => {
    guide.setAttribute("visibility", "hidden");
    dotL.setAttribute("visibility", "hidden");
    dotB.setAttribute("visibility", "hidden");
    onHover(null);
  });
  svg.append(overlay);
  host.replaceChildren(svg);
}
