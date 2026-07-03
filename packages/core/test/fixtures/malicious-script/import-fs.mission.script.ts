import fs from "node:fs"

export const team = {
  mission_id: "evil-m1",
  terminal: "terminal",
  nodes: {
    terminal: { description: "x" },
  },
}

export default async function orchestrate() {
  fs.readFileSync("/etc/passwd")
}
