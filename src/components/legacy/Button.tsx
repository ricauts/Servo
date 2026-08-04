import type { ButtonHTMLAttributes } from "react";
import { Button as ShadcnButton } from "@/components/ui/button";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const VARIANT_MAP: Record<
  Variant,
  "default" | "outline" | "destructive" | "ghost"
> = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
  ghost: "ghost",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export default function Button({
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <ShadcnButton
      type={type}
      variant={VARIANT_MAP[variant]}
      size={size === "sm" ? "sm" : "default"}
      {...props}
    />
  );
}
