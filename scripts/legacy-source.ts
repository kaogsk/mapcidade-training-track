/**
 * Fictional source material for the synthetic "legacy" bundle (legacy/legacy-track.html).
 *
 * The real tool started as a single multi-megabyte HTML page: lesson data minified into one
 * `const` line with terse keys, every screenshot inlined as a base64 data URI, and the app code
 * right after it. This file recreates that shape with invented content about a fictional GIS
 * platform ("MapCidade"), so the extractor has something realistic to chew on. Screenshots are
 * simple generated SVG mock-ups.
 */

// ------------------------------------------------------------------ mock screenshots

interface Mock {
  title: string;
  /** Layer names in the left panel. */
  panel: string[];
  /** Index of the highlighted toolbar button (0..7), or -1. */
  tool: number;
  /** Short label drawn in a callout over the map. */
  callout?: string;
  /** Extra overlay: a drawn polygon, a measure line, a form, a table. */
  overlay?: "polygon" | "measure" | "form" | "table" | "search";
  accent?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function mockSvg(m: Mock): string {
  const accent = m.accent ?? "#2f80ed";
  const tools = Array.from({ length: 8 }, (_, i) => {
    const x = 196 + i * 34;
    const on = i === m.tool;
    return `<rect x="${x}" y="10" width="26" height="22" rx="4" fill="${on ? accent : "#e8edf3"}"/>` +
      (on ? `<circle cx="${x + 13}" cy="21" r="20" fill="none" stroke="#e5484d" stroke-width="3"/>` : "");
  }).join("");
  const panel = m.panel
    .map((p, i) => `<rect x="14" y="${62 + i * 28}" width="12" height="12" rx="2" fill="${i % 2 ? "#cbd5e1" : accent}"/><text x="34" y="${73 + i * 28}" font-size="12" fill="#334155">${esc(p)}</text>`)
    .join("");
  const roads = `<path d="M180 300 C260 250 330 270 420 210 S560 140 630 160" stroke="#f8fafc" stroke-width="9" fill="none"/><path d="M300 390 L360 60" stroke="#f8fafc" stroke-width="7"/>`;
  const blocks = [[200, 80, 70, 50], [470, 250, 90, 60], [520, 80, 60, 70], [220, 320, 60, 45]]
    .map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#dbe7d3" stroke="#a3b899"/>`).join("");
  const overlays: Record<NonNullable<Mock["overlay"]>, string> = {
    polygon: `<polygon points="380,120 460,110 480,180 400,200" fill="${accent}" fill-opacity=".25" stroke="${accent}" stroke-width="3"/>${[[380, 120], [460, 110], [480, 180], [400, 200]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#fff" stroke="${accent}" stroke-width="2"/>`).join("")}`,
    measure: `<path d="M240 260 L420 170 L540 210" stroke="#e5484d" stroke-width="3" stroke-dasharray="8 5" fill="none"/><rect x="430" y="140" width="96" height="24" rx="4" fill="#fff" stroke="#e5484d"/><text x="440" y="157" font-size="12" fill="#e5484d">312.4 m</text>`,
    form: `<rect x="400" y="60" width="220" height="300" rx="6" fill="#fff" stroke="#94a3b8"/>${["Parcel code", "Land use", "Area (m2)", "Owner type"].map((f, i) => `<text x="414" y="${92 + i * 56}" font-size="11" fill="#475569">${f}</text><rect x="414" y="${98 + i * 56}" width="192" height="24" rx="3" fill="#f1f5f9" stroke="#cbd5e1"/>`).join("")}`,
    table: `<rect x="190" y="60" width="430" height="300" fill="#fff" stroke="#94a3b8"/>${Array.from({ length: 8 }, (_, i) => `<rect x="190" y="${60 + i * 36}" width="430" height="36" fill="${i === 0 ? "#e2e8f0" : i % 2 ? "#fff" : "#f8fafc"}"/>`).join("")}${["When", "Who", "Layer", "Action"].map((h, i) => `<text x="${200 + i * 105}" y="83" font-size="12" font-weight="bold" fill="#334155">${h}</text>`).join("")}`,
    search: `<rect x="196" y="48" width="280" height="30" rx="15" fill="#fff" stroke="${accent}" stroke-width="2"/><text x="214" y="68" font-size="12" fill="#64748b">12 Harbor Street, Rivermeadow</text><path d="M420 210 l12 -30 a14 14 0 1 0 -24 0 z" fill="#e5484d"/>`,
  };
  const callout = m.callout
    ? `<rect x="196" y="352" width="${m.callout.length * 7 + 20}" height="28" rx="6" fill="#0f172a" fill-opacity=".85"/><text x="206" y="371" font-size="12" fill="#fff">${esc(m.callout)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" width="640" height="400" font-family="Segoe UI, Arial, sans-serif">` +
    `<rect width="640" height="400" fill="#eef2f6"/>` +
    `<rect width="640" height="42" fill="#fff"/><text x="14" y="27" font-size="15" font-weight="bold" fill="${accent}">MapCidade</text><text x="100" y="27" font-size="12" fill="#64748b">${esc(m.title)}</text>${tools}` +
    `<rect x="0" y="42" width="180" height="358" fill="#fff"/><text x="14" y="52" font-size="10" fill="#94a3b8">LAYERS</text>${panel}` +
    `<rect x="180" y="42" width="460" height="358" fill="#e3ebe0"/>${blocks}${roads}${m.overlay ? overlays[m.overlay] : ""}${callout}</svg>`;
}

// ------------------------------------------------------------------ terse legacy shapes

export interface LQ { q: string; s?: string; o: string[]; a: number; e: string; img?: string }
export interface LL { id: string; t: string; num: string | null; xp: number; boss?: boolean; b: { t: string; h: string; f: string[] }[]; q: LQ[] }
export interface LCh { t: string; num: string; l: LL[] }
export interface LTrack { key: string; name: string; icon: string; ch: LCh[] }

const LAYERS = ["Parcels", "Streets", "Buildings", "Zoning", "Street trees", "Water network"];

export const IMAGES: Record<string, { caption: [string, string]; mock: Mock }> = {
  Viewer_1: { caption: ["1.1", "The workspace: toolbar on top, layer panel on the left, map in the centre"], mock: { title: "Workspace", panel: LAYERS, tool: -1, callout: "Toolbar, layer panel and map" } },
  Viewer_2: { caption: ["1.2", "The zoom-to-extent button"], mock: { title: "Navigation", panel: LAYERS, tool: 1 } },
  Viewer_3: { caption: ["1.3", "Address search with the result pinned on the map"], mock: { title: "Search", panel: LAYERS, tool: 0, overlay: "search" } },
  Viewer_4: { caption: ["2.1", "Layer panel with the Zoning layer switched off"], mock: { title: "Layers", panel: LAYERS, tool: -1, callout: "Tick a layer to show it" } },
  Viewer_5: { caption: ["2.2", "Measuring a distance along a street"], mock: { title: "Measure", panel: LAYERS, tool: 4, overlay: "measure" } },
  Edit_1: { caption: ["3.1", "The pencil button opens an edit session for the selected layer"], mock: { title: "Editing", panel: LAYERS, tool: 6, accent: "#0e9f6e" } },
  Edit_2: { caption: ["3.2", "A new parcel being drawn vertex by vertex"], mock: { title: "Editing - Parcels", panel: LAYERS, tool: 6, overlay: "polygon", accent: "#0e9f6e" } },
  Edit_3: { caption: ["4.1", "Attribute form shown after the geometry is closed"], mock: { title: "Attributes", panel: LAYERS, tool: 6, overlay: "form", accent: "#0e9f6e" } },
  Admin_1: { caption: ["5.1", "Group permissions per layer"], mock: { title: "Administration", panel: ["Groups", "Users", "Layers", "Audit log"], tool: 7, overlay: "table", accent: "#7c3aed" } },
  Admin_2: { caption: ["5.2", "The audit log filtered by layer"], mock: { title: "Audit log", panel: ["Groups", "Users", "Layers", "Audit log"], tool: 7, overlay: "table", accent: "#7c3aed", callout: "Filter: layer = Parcels" } },
  // Left behind by an older version of the handbook: never referenced by any lesson.
  Viewer_99: { caption: ["9.9", "Old toolbar (unused)"], mock: { title: "Old toolbar", panel: LAYERS, tool: 3 } },
};

/** One screenshot that the old authoring tool pasted straight into a lesson's HTML. */
export const INLINE_IMAGE: Mock = { title: "Undo", panel: LAYERS, tool: 5, callout: "Undo reverts the last vertex", accent: "#0e9f6e" };

export const INLINE_PLACEHOLDER = "{{INLINE_IMG}}";

export const TRACKS: LTrack[] = [
  {
    key: "Viewer",
    name: "Map Viewer",
    icon: "map",
    ch: [
      {
        t: "Getting around",
        num: "1",
        l: [
          {
            id: "Viewer-1-1", t: "The workspace at a glance", num: "1.1", xp: 20,
            b: [
              { t: "Three areas", h: "<p>The screen has three areas: the <strong>toolbar</strong> along the top, the <strong>layer panel</strong> on the left and the <strong>map</strong> in the centre. Almost every support call starts by asking the user which of the three they are looking at.</p>", f: ["Viewer_1"] },
              { t: "Who sees what", h: "<p>The layers listed in the panel depend on the groups the user belongs to. Two people on the same screen can see different layer lists, and that is expected.</p>", f: [] },
            ],
            q: [{ q: "A user says a layer is missing from the panel, but a colleague can see it. What is the most likely cause?", o: ["The browser cache", "The two users are in different groups", "The layer was deleted", "The map is zoomed out"], a: 1, e: "The layer list is filtered by group permissions." }],
          },
          {
            id: "Viewer-1-2", t: "Pan, zoom and extents", num: "1.2", xp: 20,
            b: [{ t: "Moving around", h: "<p>Drag to pan, scroll to zoom. The <em>zoom to extent</em> button brings the whole city back into view, which is the quickest way out when a user is lost over an empty area.</p>", f: ["Viewer_2"] }],
            q: [
              { q: "Complete the sentence.", s: "When the user is lost over an empty area, use _____ to bring the city back.", o: ["zoom to extent", "the print tool", "the audit log"], a: 0, e: "When the user is lost over an empty area, use zoom to extent to bring the city back." },
              { q: "Which action pans the map?", o: ["Scrolling", "Dragging", "Double right-click"], a: 1, e: "Dragging pans; scrolling zooms." },
            ],
          },
          {
            id: "Viewer-1-3", t: "Finding an address", num: "1.3", xp: 25,
            b: [{ t: "Search box", h: "<p>The search box accepts a street address or a parcel code. Results are pinned on the map; clicking the pin opens the parcel.</p><ul><li>Start with the street name, then the number.</li><li>Parcel codes are searched exactly.</li></ul>", f: ["Viewer_3"] }],
            q: [{ q: "Which toolbar button is highlighted in this screenshot?", o: ["Search", "Measure", "Edit", "Print"], a: 0, e: "The first button opens the search box.", img: "Viewer_3" }],
          },
        ],
      },
      {
        t: "Reading the map",
        num: "2",
        l: [
          {
            id: "Viewer-2-1", t: "Turning layers on and off", num: "2.1", xp: 20,
            b: [{ t: "Visibility", h: "<p>Tick a layer in the panel to draw it. Some layers only draw below a certain scale: if a ticked layer does not appear, ask the user to zoom in before opening a ticket.</p>", f: ["Viewer_4"] }],
            q: [
              { q: "A ticked layer does not draw. What do you ask first?", o: ["To reinstall the browser", "To zoom in", "To log out"], a: 1, e: "Many layers have a minimum scale and only draw when zoomed in." },
              { q: "Complete the sentence.", s: "Layers that only draw below a certain _____ look missing when zoomed out.", o: ["scale", "colour", "group"], a: 0, e: "Layers that only draw below a certain scale look missing when zoomed out." },
            ],
          },
          {
            id: "Viewer-2-2", t: "Identify and measure", num: "2.2", xp: 25,
            b: [
              { t: "Identify", h: "<p>Clicking a feature with the identify tool lists its attributes. If nothing is listed, the click probably hit an area with no feature.</p>", f: [] },
              { t: "Measure", h: "<p>The measure tool draws a line or an area and shows the length in metres. Double-click to finish.</p>", f: ["Viewer_5"] },
            ],
            q: [{ q: "How does the user finish a measurement?", o: ["Pressing Esc", "Double-clicking", "Closing the panel"], a: 1, e: "A double-click closes the line or area." }],
          },
          {
            id: "Viewer-2-3", t: "Chapter review", num: null, xp: 40, boss: true, b: [],
            q: [
              { q: "Where is the list of layers?", o: ["Toolbar", "Left panel", "Map footer"], a: 1, e: "Layers live in the left panel." },
              { q: "What does zoom to extent do?", o: ["Shows the whole city", "Prints the map", "Opens the search"], a: 0, e: "It zooms back to the full city extent." },
              { q: "The identify tool shows nothing after a click. Most likely?", o: ["Server down", "The click missed every feature", "Wrong password"], a: 1, e: "An empty identify result usually means the click hit no feature." },
            ],
          },
        ],
      },
    ],
  },
  {
    key: "Edit",
    name: "Layer Editing",
    icon: "pen",
    ch: [
      {
        t: "Edit sessions",
        num: "3",
        l: [
          {
            id: "Edit-3-1", t: "Starting an edit session", num: "3.1", xp: 20,
            b: [{ t: "The pencil", h: "<p>Select a layer in the panel and press the pencil. The button stays grey when the user's group can view the layer but not edit it.</p>", f: ["Edit_1"] }],
            q: [{ q: "The pencil is grey for one layer only. Why?", o: ["The layer is view-only for the user's group", "The browser is outdated", "The map is too far out"], a: 0, e: "Edit rights are granted per layer and per group." }],
          },
          {
            id: "Edit-3-2", t: "Drawing a new parcel", num: "3.2", xp: 30,
            b: [{ t: "Vertex by vertex", h: "<p>Click to add each vertex and double-click to close the polygon. The attribute form opens as soon as the polygon is closed.</p>", f: ["Edit_2"] }],
            q: [
              { q: "When does the attribute form open?", o: ["Before the first vertex", "After the polygon is closed", "Only after saving"], a: 1, e: "Closing the polygon opens the form." },
              { q: "Complete the sentence.", s: "A double-click _____ the polygon.", o: ["deletes", "closes", "moves"], a: 1, e: "A double-click closes the polygon." },
            ],
          },
          {
            id: "Edit-3-3", t: "Snapping", num: "3.3", xp: 25,
            b: [{ t: "Why snap", h: "<p>With snapping on, a new vertex jumps to the nearest existing vertex. Neighbouring parcels then share the border exactly, with no gaps or slivers.</p>", f: [] }],
            q: [{ q: "What problem does snapping prevent?", o: ["Slow drawing", "Gaps and slivers between neighbours", "Wrong colours"], a: 1, e: "Shared borders stay exact." }],
          },
        ],
      },
      {
        t: "Attributes and saving",
        num: "4",
        l: [
          {
            id: "Edit-4-1", t: "The attribute form", num: "4.1", xp: 25,
            b: [
              { t: "Required fields", h: "<p>Fields marked with an asterisk are required; the form will not save while one is empty. Drop-down fields only accept values from their list.</p>", f: ["Edit_3"] },
              { t: "Undo", h: `<p>While drawing, the undo button removes the last vertex, not the whole feature.</p><p><img src="${INLINE_PLACEHOLDER}" alt="Undo button"></p>`, f: [] },
            ],
            q: [
              { q: "The Save button does nothing. What do you check first?", o: ["An empty required field", "The screen resolution", "The layer colour"], a: 0, e: "An empty required field blocks saving." },
              { q: "What does undo remove while drawing?", o: ["The whole feature", "The last vertex", "Every edit of the session"], a: 1, e: "Undo steps back one vertex." },
            ],
          },
          {
            id: "Edit-4-2", t: "Saving and discarding", num: "4.2", xp: 25,
            b: [{ t: "Commit", h: "<p>Edits stay local until <strong>Save</strong> is pressed. Closing the session without saving discards them, and the platform asks for confirmation first.</p>", f: [] }],
            q: [{ q: "A user lost an afternoon of edits. What most likely happened?", o: ["The session was closed without saving", "The layer was renamed", "The browser zoomed out"], a: 0, e: "Edits are only stored when Save is pressed." }],
          },
        ],
      },
    ],
  },
  {
    key: "Admin",
    name: "Administration",
    icon: "shield",
    ch: [
      {
        t: "People and access",
        num: "5",
        l: [
          {
            id: "Admin-5-1", t: "Users and groups", num: "5.1", xp: 20,
            b: [{ t: "Groups, not people", h: "<p>Permissions are granted to groups; users inherit them by membership. To give someone access, add them to the right group instead of granting rights one by one.</p>", f: [] }],
            q: [{ q: "How should access be granted to a new analyst?", o: ["Layer by layer to the user", "By adding the user to a group", "By sharing a colleague's login"], a: 1, e: "Groups keep permissions consistent and auditable." }],
          },
          {
            id: "Admin-5-2", t: "Layer permissions", num: "5.2", xp: 30,
            b: [{ t: "View and edit", h: "<p>Each group gets <em>view</em> and/or <em>edit</em> per layer. Edit without view is not allowed: the screen grants view automatically.</p>", f: ["Admin_1"] }],
            q: [
              { q: "Can a group edit a layer it cannot view?", o: ["Yes", "No, edit implies view"], a: 1, e: "Edit always comes with view." },
              { q: "Complete the sentence.", s: "Permissions are granted per layer and per _____.", o: ["user", "group", "browser"], a: 1, e: "Permissions are granted per layer and per group." },
            ],
          },
          {
            id: "Admin-5-3", t: "Reading the audit log", num: "5.3", xp: 25,
            b: [{ t: "Who changed what", h: "<p>The audit log records every insert, update and delete with the user and the time. Filter by layer first; then by user or by date.</p>", f: ["Admin_2"] }],
            q: [{ q: "What is the best first filter when investigating a changed parcel?", o: ["The layer", "The browser", "The screen size"], a: 0, e: "Filtering by layer narrows the log the fastest." }],
          },
          {
            id: "Admin-5-4", t: "Chapter review", num: null, xp: 40, boss: true, b: [],
            q: [
              { q: "Where do users get their permissions from?", o: ["Their groups", "Their browser", "The map scale"], a: 0, e: "Permissions are inherited from groups." },
              { q: "What does the audit log record?", o: ["Only logins", "Inserts, updates and deletes", "Only deletes"], a: 1, e: "Every data change is logged." },
            ],
          },
        ],
      },
    ],
  },
];
