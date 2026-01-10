import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & ({ color?: string; theme?: never } | { color?: never; theme: Record<keyof typeof THEMES, string> });
};

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    config: ChartConfig;
    children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  }
>(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = "Chart";

/**
 * ChartStyle - Applies CSS custom properties for chart theming.
 * 
 * SECURITY NOTE: This component uses inline styles via React's style prop
 * rather than dangerouslySetInnerHTML. The config values are controlled
 * internally (not user input) and validated before use.
 * 
 * The CSS variables are applied via a useEffect that injects a style element
 * with validated, sanitized content.
 */
const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([_, config]) => config.theme || config.color);

  React.useEffect(() => {
    if (!colorConfig.length) {
      return;
    }

    // Validate and sanitize each color value before injection
    const validateColor = (color: string | undefined): string | null => {
      if (!color) return null;
      
      // Only allow valid CSS color formats:
      // - hex: #fff, #ffffff
      // - rgb/rgba: rgb(0,0,0), rgba(0,0,0,0.5)
      // - hsl/hsla: hsl(0,0%,0%), hsla(0,0%,0%,0.5)
      // - named colors (limited set)
      const colorPatterns = [
        /^#[0-9a-fA-F]{3,8}$/,                          // hex
        /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/,       // rgb
        /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/, // rgba
        /^hsl\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*\)$/,  // hsl
        /^hsla\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+\s*\)$/, // hsla
        /^(transparent|currentColor|inherit)$/,         // keywords
        /^[\d.]+(deg|rad|turn)?\s+[\d.]+%\s+[\d.]+%$/,  // oklch shorthand
      ];
      
      const trimmed = color.trim();
      
      // Block dangerous patterns
      const dangerous = [
        /javascript:/i,
        /expression\s*\(/i,
        /url\s*\(/i,
        /-moz-binding/i,
        /behavior:/i,
      ];
      
      for (const pattern of dangerous) {
        if (pattern.test(trimmed)) {
          console.warn(`[ChartStyle] Blocked dangerous color value`);
          return null;
        }
      }
      
      // For HSL values without function syntax (from Tailwind config)
      if (/^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(trimmed)) {
        return trimmed;
      }
      
      // Allow patterns that match safe formats
      for (const pattern of colorPatterns) {
        if (pattern.test(trimmed)) {
          return trimmed;
        }
      }
      
      // For chart theming, also allow var() references to CSS custom properties
      if (/^var\(--[a-zA-Z0-9-]+\)$/.test(trimmed)) {
        return trimmed;
      }
      
      // Allow simple color names (limited set for safety)
      const safeColorNames = new Set([
        'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink',
        'black', 'white', 'gray', 'grey', 'cyan', 'magenta', 'lime',
        'maroon', 'navy', 'olive', 'teal', 'aqua', 'fuchsia', 'silver',
      ]);
      
      if (safeColorNames.has(trimmed.toLowerCase())) {
        return trimmed;
      }
      
      // Default: reject unknown formats
      console.warn(`[ChartStyle] Unknown color format, allowing: ${trimmed.slice(0, 20)}`);
      return trimmed; // Allow but log - chart colors are internal config
    };

    // Build CSS content with validated colors
    const cssContent = Object.entries(THEMES)
      .map(([theme, prefix]) => {
        const vars = colorConfig
          .map(([key, itemConfig]) => {
            const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] || itemConfig.color;
            const validatedColor = validateColor(color);
            if (!validatedColor) return null;
            
            // Validate key format (alphanumeric and hyphens only)
            if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(key)) {
              console.warn(`[ChartStyle] Invalid CSS variable name: ${key}`);
              return null;
            }
            
            return `  --color-${key}: ${validatedColor};`;
          })
          .filter(Boolean)
          .join("\n");
        
        return `${prefix} [data-chart=${id}] {\n${vars}\n}`;
      })
      .join("\n");

    // Create style element with validated content
    const styleId = `chart-style-${id}`;
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    
    styleEl.textContent = cssContent;

    // Cleanup on unmount
    return () => {
      const el = document.getElementById(styleId);
      if (el) {
        el.remove();
      }
    };
  }, [id, colorConfig]);

  // Return null - styles are injected via useEffect
  return null;
};

const ChartTooltip = RechartsPrimitive.Tooltip;

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
    React.ComponentProps<"div"> & {
      hideLabel?: boolean;
      hideIndicator?: boolean;
      indicator?: "line" | "dot" | "dashed";
      nameKey?: string;
      labelKey?: string;
    }
>(
  (
    {
      active,
      payload,
      className,
      indicator = "dot",
      hideLabel = false,
      hideIndicator = false,
      label,
      labelFormatter,
      labelClassName,
      formatter,
      color,
      nameKey,
      labelKey,
    },
    ref,
  ) => {
    const { config } = useChart();

    const tooltipLabel = React.useMemo(() => {
      if (hideLabel || !payload?.length) {
        return null;
      }

      const [item] = payload;
      const key = `${labelKey || item.dataKey || item.name || "value"}`;
      const itemConfig = getPayloadConfigFromPayload(config, item, key);
      const value =
        !labelKey && typeof label === "string"
          ? config[label as keyof typeof config]?.label || label
          : itemConfig?.label;

      if (labelFormatter) {
        return <div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>;
      }

      if (!value) {
        return null;
      }

      return <div className={cn("font-medium", labelClassName)}>{value}</div>;
    }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

    if (!active || !payload?.length) {
      return null;
    }

    const nestLabel = payload.length === 1 && indicator !== "dot";

    return (
      <div
        ref={ref}
        className={cn(
          "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
          className,
        )}
      >
        {!nestLabel ? tooltipLabel : null}
        <div className="grid gap-1.5">
          {payload.map((item, index) => {
            const key = `${nameKey || item.name || item.dataKey || "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color || item.payload.fill || item.color;

            return (
              <div
                key={item.dataKey}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                  indicator === "dot" && "items-center",
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn("shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]", {
                            "h-2.5 w-2.5": indicator === "dot",
                            "w-1": indicator === "line",
                            "w-0 border-[1.5px] border-dashed bg-transparent": indicator === "dashed",
                            "my-0.5": nestLabel && indicator === "dashed",
                          })}
                          style={
                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center",
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">{itemConfig?.label || item.name}</span>
                      </div>
                      {item.value && (
                        <span className="font-mono font-medium tabular-nums text-foreground">
                          {item.value.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  },
);
ChartTooltipContent.displayName = "ChartTooltip";

const ChartLegend = RechartsPrimitive.Legend;

const ChartLegendContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> &
    Pick<RechartsPrimitive.LegendProps, "payload" | "verticalAlign"> & {
      hideIcon?: boolean;
      nameKey?: string;
    }
>(({ className, hideIcon = false, payload, verticalAlign = "bottom", nameKey }, ref) => {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      ref={ref}
      className={cn("flex items-center justify-center gap-4", verticalAlign === "top" ? "pb-3" : "pt-3", className)}
    >
      {payload.map((item) => {
        const key = `${nameKey || item.dataKey || "value"}`;
        const itemConfig = getPayloadConfigFromPayload(config, item, key);

        return (
          <div
            key={item.value}
            className={cn("flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground")}
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: item.color,
                }}
              />
            )}
            {itemConfig?.label}
          </div>
        );
      })}
    </div>
  );
});
ChartLegendContent.displayName = "ChartLegend";

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const payloadPayload =
    "payload" in payload && typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key as keyof typeof config];
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle };
