export type ParsedCliArgs = {
  flags: Set<string>
  options: Map<string, string>
  positional: string[]
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  const flags = new Set<string>()
  const options = new Map<string, string>()
  const positional: string[] = []

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "-C" || arg === "--project") {
      const next = args[++i]
      if (!next) throw new Error(`${arg} requires a project path`)
      options.set("project", next)
      continue
    }
    if (arg.startsWith("--") && arg.includes("=")) {
      const eq = arg.indexOf("=")
      options.set(arg.slice(2, eq), arg.slice(eq + 1))
      continue
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2)
      const next = args[i + 1]
      if (next && !next.startsWith("-")) {
        options.set(key, next)
        i++
      } else {
        flags.add(arg)
      }
      continue
    }
    if (arg.startsWith("-")) {
      flags.add(arg)
      continue
    }
    positional.push(arg)
  }

  return { flags, options, positional }
}

export function hasFlag(args: ParsedCliArgs, ...names: string[]) {
  return names.some((name) => args.flags.has(name) || args.flags.has(`--${name}`))
}

export function optionValue(args: ParsedCliArgs, key: string) {
  return args.options.get(key)
}
