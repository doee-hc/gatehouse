export function tiledObjectProp(
  obj: { properties?: unknown },
  name: string,
): string | number | boolean | undefined {
  const props = obj.properties
  if (Array.isArray(props)) {
    const entry = props.find((item) => typeof item === "object" && item && "name" in item && item.name === name)
    if (entry && typeof entry === "object" && "value" in entry) return entry.value as string | number | boolean
    return undefined
  }
  if (props && typeof props === "object" && name in props) {
    return (props as Record<string, string | number | boolean>)[name]
  }
  return undefined
}
