import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import {
  IconDeviceDesktop,
  IconMoon,
  IconSun,
} from "@tabler/icons-react"

/**
 * Three-way theme control: light, dark, follow the system.
 *
 * "System" is the default rather than a nicety — this app gets opened in a car
 * park before sunrise more often than at a desk, and the OS already knows
 * whether the user is in a dark cabin.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const options = [
    { value: "light", label: "Light", Icon: IconSun },
    { value: "dark", label: "Dark", Icon: IconMoon },
    { value: "system", label: "System", Icon: IconDeviceDesktop },
  ] as const

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5"
    >
      {options.map(({ value, label, Icon }) => {
        const active = theme === value
        return (
          <Button
            key={value}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={active}
            title={label}
            onClick={() => setTheme(value)}
            className={
              active
                ? "rounded-full bg-primary text-primary-foreground hover:bg-primary/80"
                : "rounded-full text-muted-foreground"
            }
          >
            <Icon size={15} />
          </Button>
        )
      })}
    </div>
  )
}