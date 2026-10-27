// The artwork is the supplied sheet, cropped in CSS without redrawing the characters.
export const SQUAD = [
  {
    id: "orchy",
    name: "Orchy",
    category: "The orchestrator",
    color: "#e4eee7",
    x: 24,
    y: 23,
    description:
      "Your one point of contact. Turns a big ask into the right next step, then brings the team together.",
    tag: "All together now",
  },
  {
    id: "red",
    name: "Closer",
    category: "The relationship builder",
    color: "#ff594e",
    x: 66,
    y: 23,
    description:
      "Keeps track of conversations, prepares quotes, and drafts thoughtful follow-ups. You decide what gets sent.",
    tag: "Make the connection",
  },
  {
    id: "orange",
    name: "Scribe",
    category: "The word person",
    color: "#ffad5c",
    x: 108,
    y: 23,
    description:
      "Turns scattered notes into clear drafts, briefs, and project updates. A fresh first pass, ready for your voice.",
    tag: "Find the right words",
  },
  {
    id: "yellow",
    name: "Ledger",
    category: "The numbers person",
    color: "#f5d653",
    x: 150,
    y: 23,
    description:
      "Organizes invoices, reviews the numbers, and prepares payments. Anything that spends money waits for you.",
    tag: "Make it add up",
  },
  {
    id: "green",
    name: "Builder",
    category: "The hands-on maker",
    color: "#9ee65b",
    x: 192,
    y: 23,
    description:
      "Takes on code, works through bugs, and turns a rough idea into something you can open, test, and improve.",
    tag: "From idea to working",
  },
  {
    id: "cyan",
    name: "Scout",
    category: "The curious researcher",
    color: "#62dfe3",
    x: 24,
    y: 78,
    description:
      "Explores a question, compares the possibilities, and brings the useful details back in a readable research brief.",
    tag: "Go find the good stuff",
  },
  {
    id: "blue",
    name: "Inbox",
    category: "The inbox companion",
    color: "#7d9dff",
    x: 66,
    y: 78,
    description:
      "Reads the thread, finds the context, and prepares a reply. Your inbox gets lighter; you still press the final OK.",
    tag: "A little less unread",
  },
  {
    id: "purple",
    name: "Tempo",
    category: "The planner",
    color: "#be96ff",
    x: 108,
    y: 78,
    description:
      "Brings structure to a full week, prepares schedules, and spots what needs attention. Calendar changes ask first.",
    tag: "Room for what matters",
  },
  {
    id: "pink",
    name: "Spark",
    category: "The creative teammate",
    color: "#f28ac8",
    x: 150,
    y: 78,
    description:
      "Gathers ideas, drafts social updates, and helps your next story take shape. Every post waits for your approval.",
    tag: "Start something bright",
  },
  {
    id: "gray",
    name: "Keeper",
    category: "The organizer",
    color: "#b2b7c2",
    x: 192,
    y: 78,
    description:
      "Makes sense of files and folders so the useful things stay easy to find. Deleting anything always waits for you.",
    tag: "A place for everything",
  },
];
export const byId = Object.fromEntries(SQUAD.map((bot) => [bot.id, bot]));
export function renderSprite(element, id) {
  const bot = byId[id] || byId.orchy;
  element.classList.add("sprite");
  element.style.setProperty("--sprite-x", bot.x);
  element.style.setProperty("--sprite-y", bot.y);
  const img = document.createElement("img");
  img.src = "assets/orchy_and_sugagents.svg";
  img.alt = "";
  img.draggable = false;
  element.replaceChildren(img);
  element.setAttribute("aria-hidden", "true");
}
