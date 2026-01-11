const globalAny = global as typeof globalThis & {
  __fabricPropPatch?: boolean;
  nativeFabricUIManager?: Record<string, unknown>;
};

const STRING_TO_NUMBER = new Map<string, number>([
  ["large", 36],
  ["small", 20],
  ["all", 1],
  ["medium", 0.5],
  ["fitToContents", -1],
]);

const LOGGED_KEYWORDS = new Set<string>();

const STYLE_PROP_KEYS = new Set<string>([
  "style",
  "contentContainerStyle",
  "tabBarStyle",
  "headerStyle",
  "cardStyle",
  "labelStyle",
  "iconStyle",
  "textStyle",
]);

const NUMERIC_PROP_KEYS = new Set<string>([
  "flex",
  "flexGrow",
  "flexShrink",
  "zIndex",
  "letterSpacing",
  "size",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "fontSize",
  "lineHeight",
  "borderRadius",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginHorizontal",
  "marginVertical",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingHorizontal",
  "paddingVertical",
  "gap",
  "rowGap",
  "columnGap",
  "left",
  "right",
  "top",
  "bottom",
  "opacity",
  "shadowRadius",
  "elevation",
  "translateX",
  "translateY",
  "scale",
  "scaleX",
  "scaleY",
  "sheetAllowedDetents",
  "sheetLargestUndimmedDetentIndex",
  "sheetLargestUndimmedDetent",
  "sheetInitialDetentIndex",
  "allowedDetents",
  "detents",
  "largestUndimmedDetentIndex",
  "largestUndimmedDetent",
  "initialDetentIndex",
]);

const NUMERIC_KEY_REGEX = /(width|height|size|radius|margin|padding|gap|top|left|right|bottom|opacity|elevation|lineHeight|fontSize|zIndex|translate|scale|spacing|inset|offset|detent)/i;

const shouldNormalizeKey = (key: string) => NUMERIC_PROP_KEYS.has(key) || NUMERIC_KEY_REGEX.test(key);

const normalizeValue = (value: unknown) => {
  if (typeof value === "string" && STRING_TO_NUMBER.has(value)) {
    return STRING_TO_NUMBER.get(value);
  }
  return value;
};

const logKeyword = (viewName: unknown, path: string, value: string) => {
  const key = `${String(viewName)}:${path}:${value}`;
  if (LOGGED_KEYWORDS.has(key)) {
    return;
  }
  LOGGED_KEYWORDS.add(key);
  // eslint-disable-next-line no-console
  console.warn("[fabric-prop-normalize]", { viewName, path, value });
};

const normalizeDeep = (value: unknown, viewName: unknown, path: string, parentKey?: string): unknown => {
  if (typeof value === "string" && STRING_TO_NUMBER.has(value)) {
    if (!parentKey || shouldNormalizeKey(parentKey)) {
      logKeyword(viewName, path, value);
      return STRING_TO_NUMBER.get(value);
    }
    logKeyword(viewName, path, value);
    return value;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item, index) => {
      const nextPath = `${path}[${index}]`;
      const normalized = normalizeDeep(item, viewName, nextPath, parentKey);
      if (normalized !== item) {
        changed = true;
      }
      return normalized;
    });
    return changed ? mapped : value;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    Object.keys(next).forEach((key) => {
      const nextPath = path ? `${path}.${key}` : key;
      const normalized = normalizeDeep(next[key], viewName, nextPath, key);
      if (normalized !== next[key]) {
        next[key] = normalized;
        changed = true;
      }
    });
    return changed ? next : value;
  }
  return value;
};

const normalizeStyleObject = (style: Record<string, unknown>) => {
  let changed = false;
  const next: Record<string, unknown> = { ...style };
  Object.keys(next).forEach((key) => {
    const value = next[key];
    if (Array.isArray(value)) {
      if (key === "transform") {
        const mapped = value.map((entry) => {
          if (!entry || typeof entry !== "object") {
            return entry;
          }
          const transform = entry as Record<string, unknown>;
          let transformChanged = false;
          const nextTransform: Record<string, unknown> = { ...transform };
          Object.keys(nextTransform).forEach((transformKey) => {
            if (NUMERIC_PROP_KEYS.has(transformKey)) {
              const normalized = normalizeValue(nextTransform[transformKey]);
              if (normalized !== nextTransform[transformKey]) {
                nextTransform[transformKey] = normalized;
                transformChanged = true;
              }
            }
          });
          return transformChanged ? nextTransform : entry;
        });
        const mutated = mapped.some((item, index) => item !== value[index]);
        if (mutated) {
          next[key] = mapped;
          changed = true;
        }
      }
      return;
    }
    if (shouldNormalizeKey(key)) {
      const normalized = normalizeValue(value);
      if (normalized !== value) {
        next[key] = normalized;
        changed = true;
      }
      return;
    }
    if (value && typeof value === "object") {
      const normalized = normalizeStyleObject(value as Record<string, unknown>);
      if (normalized !== value) {
        next[key] = normalized;
        changed = true;
      }
    }
  });
  return changed ? next : style;
};

const normalizeStyleValue = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    const mapped = value.map((entry) => {
      if (!entry || typeof entry !== "object") {
        return entry;
      }
      return normalizeStyleObject(entry as Record<string, unknown>);
    });
    const mutated = mapped.some((item, index) => item !== value[index]);
    return mutated ? mapped : value;
  }
  return normalizeStyleObject(value as Record<string, unknown>);
};

const normalizeProps = (props: unknown, viewName?: unknown) => {
  if (!props || typeof props !== "object") {
    return props;
  }
  const typed = props as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...typed };
  Object.keys(next).forEach((key) => {
    const value = next[key];
    if (Array.isArray(value)) {
      if (STYLE_PROP_KEYS.has(key) || key.endsWith("Style")) {
        const normalized = normalizeStyleValue(value);
        if (normalized !== value) {
          next[key] = normalized;
          changed = true;
        }
        return;
      }
      if (shouldNormalizeKey(key)) {
        const mapped = value.map((item) =>
          typeof item === "string" && STRING_TO_NUMBER.has(item)
            ? STRING_TO_NUMBER.get(item)
            : item,
        );
        const mutated = mapped.some((item, index) => item !== value[index]);
        if (mutated) {
          next[key] = mapped;
          changed = true;
        }
      }
      return;
    }
    if (STYLE_PROP_KEYS.has(key) || key.endsWith("Style")) {
      const normalized = normalizeStyleValue(value);
      if (normalized !== value) {
        next[key] = normalized;
        changed = true;
      }
      return;
    }
    if (shouldNormalizeKey(key)) {
      const normalized = normalizeValue(value);
      if (normalized !== value) {
        next[key] = normalized;
        changed = true;
      }
    }
  });
  const deepNormalized = normalizeDeep(changed ? next : props, viewName, "", undefined);
  return deepNormalized !== (changed ? next : props) ? deepNormalized : changed ? next : props;
};

const wrapFabric = (fabric: Record<string, unknown>) =>
  new Proxy(fabric, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      if (prop === "createNode") {
        return (...args: unknown[]) => {
          if (args.length >= 4) {
            const viewName = args[1];
            args[3] = normalizeProps(args[3], viewName);
          }
          return (value as (...args: unknown[]) => unknown)(...args);
        };
      }
      if (prop === "cloneNodeWithNewProps" || prop === "cloneNodeWithNewChildrenAndProps" || prop === "setNativeProps") {
        return (...args: unknown[]) => {
          if (args.length >= 2) {
            args[1] = normalizeProps(args[1]);
          }
          return (value as (...args: unknown[]) => unknown)(...args);
        };
      }
      return value;
    },
  });

const tryPatchFabric = () => {
  if (globalAny.__fabricPropPatch) {
    return true;
  }
  const fabric = globalAny.nativeFabricUIManager;
  if (!fabric) {
    return false;
  }
  globalAny.nativeFabricUIManager = wrapFabric(fabric);
  globalAny.__fabricPropPatch = true;
  return true;
};

if (!tryPatchFabric()) {
  const interval = setInterval(() => {
    if (tryPatchFabric()) {
      clearInterval(interval);
    }
  }, 50);
}
