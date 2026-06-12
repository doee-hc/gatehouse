import fs from "node:fs"

export const team = {
  mission_id: "evil-m1",
  root: "root",
  nodes: {
    root: { parent: null, description: "x" },
  },
}

export default async function orchestrate() {
  fs.readFileSync("/etc/passwd")
}
